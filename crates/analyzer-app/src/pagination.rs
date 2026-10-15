//! Bounded ordinal bookmarks. Payloads are decoded only after seeking to a page.
use anyhow::Result;
use rusqlite::{Connection, OptionalExtension, types::Value};
use std::collections::BTreeMap;

#[derive(Debug, Default)]
pub(crate) struct OrdinalPager {
    anchors: BTreeMap<usize, (i64, u64)>,
    clock: u64,
    range: Option<(i64, i64)>,
}
impl OrdinalPager {
    // SQL scope, ordering and page coordinates are passed separately by internal callers.
    #[allow(clippy::too_many_arguments)]
    pub fn boundary(
        &mut self,
        c: &Connection,
        from: &str,
        condition: &str,
        args: &[Value],
        key: &str,
        descending: bool,
        total: usize,
        offset: usize,
    ) -> Result<Option<i64>> {
        if offset >= total {
            return Ok(None);
        }
        let order = if descending { "DESC" } else { "ASC" };
        if self.range.is_none() {
            let mut endpoints = Vec::new();
            for direction in ["ASC", "DESC"] {
                let endpoint = c.query_row(
                    &format!("SELECT {key} FROM {from} WHERE {condition} ORDER BY {key} {direction} LIMIT 1"),
                    rusqlite::params_from_iter(args), |r| r.get::<_, i64>(0),
                ).optional()?;
                let Some(endpoint) = endpoint else {
                    return Ok(None);
                };
                endpoints.push(endpoint);
            }
            let (first, last) = if descending {
                (endpoints[1], endpoints[0])
            } else {
                (endpoints[0], endpoints[1])
            };
            self.range = Some((first, last));
            self.anchors.insert(0, (first, 0));
            self.anchors.insert(total - 1, (last, 0));
        }
        let (first, last) = self.range.unwrap();
        if first.abs_diff(last) == (total - 1) as u64 {
            return Ok(Some(if descending {
                first - offset as i64
            } else {
                first + offset as i64
            }));
        }
        let (&index, &(anchor, _)) = self
            .anchors
            .iter()
            .min_by_key(|(index, _)| index.abs_diff(offset))
            .unwrap();
        if index == offset {
            self.remember(offset, anchor);
            return Ok(Some(anchor));
        }
        let forward = index < offset;
        let greater = forward != descending;
        let direction = if forward {
            order
        } else if descending {
            "ASC"
        } else {
            "DESC"
        };
        let comparison = if greater { ">=" } else { "<=" };
        let mut params = args.to_vec();
        params.push(anchor.into());
        params.push((index.abs_diff(offset) as i64).into());
        let boundary = c.query_row(
            &format!("SELECT {key} FROM {from} WHERE {condition} AND {key}{comparison}? ORDER BY {key} {direction} LIMIT 1 OFFSET ?"),
            rusqlite::params_from_iter(params), |r| r.get::<_, i64>(0),
        ).optional()?;
        if let Some(boundary) = boundary {
            self.remember(offset, boundary);
        }
        Ok(boundary)
    }
    pub fn remember(&mut self, index: usize, ordinal: i64) {
        self.clock = self.clock.wrapping_add(1);
        self.anchors.insert(index, (ordinal, self.clock));
        while self.anchors.len() > 128 {
            let last = *self.anchors.keys().next_back().unwrap();
            let key = *self
                .anchors
                .iter()
                .filter(|(index, _)| **index != 0 && **index != last)
                .min_by_key(|(_, (_, stamp))| *stamp)
                .unwrap()
                .0;
            self.anchors.remove(&key);
        }
    }
}
#[derive(Debug, Default)]
pub(crate) struct ReadCache {
    pub revision: Option<u64>,
    pub counts: BTreeMap<String, usize>,
    pub pagers: BTreeMap<String, OrdinalPager>,
    pub references: BTreeMap<String, usize>,
}
impl ReadCache {
    pub fn update(&mut self, revision: u64) {
        if self.revision != Some(revision) {
            *self = Self {
                revision: Some(revision),
                ..Self::default()
            };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn seeks_dense_sparse_filtered_and_reverse_pages_without_losing_rows() {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE t(ordinal INTEGER PRIMARY KEY,kind TEXT);")
            .unwrap();
        for values in [vec![0, 1, 2, 3, 4, 5], vec![1, 3, 10, 100, 101, 10000]] {
            c.execute("DELETE FROM t", []).unwrap();
            for (i, key) in values.iter().enumerate() {
                c.execute(
                    "INSERT INTO t VALUES(?1,?2)",
                    rusqlite::params![key, if i % 2 == 0 { "a" } else { "b" }],
                )
                .unwrap();
            }
            for descending in [false, true] {
                for filtered in [false, true] {
                    let mut expected = values
                        .iter()
                        .enumerate()
                        .filter(|(i, _)| !filtered || i % 2 == 0)
                        .map(|(_, key)| *key)
                        .collect::<Vec<_>>();
                    if descending {
                        expected.reverse();
                    }
                    let (condition, args) = if filtered {
                        ("kind=?", vec![Value::Text("a".into())])
                    } else {
                        ("1=1", vec![])
                    };
                    let mut pager = OrdinalPager::default();
                    for offset in [0, expected.len() - 1, 1, 2, 0, expected.len(), usize::MAX] {
                        assert_eq!(
                            pager
                                .boundary(
                                    &c,
                                    "t",
                                    condition,
                                    &args,
                                    "ordinal",
                                    descending,
                                    expected.len(),
                                    offset
                                )
                                .unwrap(),
                            expected.get(offset).copied()
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn revisiting_an_earlier_sparse_page_keeps_the_next_seek_bounded() {
        use std::sync::{
            Arc,
            atomic::{AtomicUsize, Ordering},
        };
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE t(ordinal INTEGER PRIMARY KEY); WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<4000) INSERT INTO t SELECT x*2 FROM n;").unwrap();
        let mut pager = OrdinalPager::default();
        for offset in 3800..4000 {
            pager
                .boundary(&c, "t", "1=1", &[], "ordinal", false, 4000, offset)
                .unwrap();
        }
        assert_eq!(
            pager
                .boundary(&c, "t", "1=1", &[], "ordinal", false, 4000, 2000)
                .unwrap(),
            Some(4002)
        );
        let work = Arc::new(AtomicUsize::new(0));
        let counter = work.clone();
        c.progress_handler(
            1000,
            Some(move || {
                counter.fetch_add(1, Ordering::Relaxed);
                false
            }),
        )
        .unwrap();
        assert_eq!(
            pager
                .boundary(&c, "t", "1=1", &[], "ordinal", false, 4000, 2001)
                .unwrap(),
            Some(4004)
        );
        c.progress_handler(0, None::<fn() -> bool>).unwrap();
        assert_eq!(
            work.load(Ordering::Relaxed),
            0,
            "a subsequent page must seek from a recent bookmark rather than rescan the preceding thousands of rows"
        );
    }
}
