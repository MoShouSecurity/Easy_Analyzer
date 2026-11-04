//! Deterministic AI-only log aggregation. Raw evidence is never changed.
//! Windows bound both retained text and member IDs; unrelated windows may produce
//! separate groups for the same template rather than growing with the project.
use super::*;
use chrono::{DateTime, NaiveDateTime};
use regex::Regex;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::sync::OnceLock;

const WINDOW_RECORDS: usize = 1024;
const WINDOW_BYTES: usize = 8 * 1024 * 1024;

pub(super) const INSTRUCTIONS: &str = "\n部分输入为本地规则聚合的日志组：同一来源、同一分钟（时间缺失时明确标注）、关键字段和模板相同，仅时间或事件记录序号不同。每组只发送一条完整代表记录及次数、时间分布；代表记录的位置、时间和事件序号只属于样本，不能当作每条原记录的值。只能引用该组标明的代表证据编号，应用会关联原始成员。聚合顺序不代表事件先后；不能推断组内逐条顺序，也不能把统计频次称为已证实攻击。非代表记录未逐条发送。\n";

struct Group {
    items: Vec<TextEvidence>,
    times: BTreeMap<String, usize>,
    unknown_times: usize,
}
impl Group {
    fn new(record: &Record, text: String, tokens: usize) -> Self {
        let mut group = Self {
            items: Vec::new(),
            times: BTreeMap::new(),
            unknown_times: 0,
        };
        group.add(record, text, tokens);
        group
    }
    fn add(&mut self, record: &Record, text: String, tokens: usize) {
        self.items.push(TextEvidence {
            id: record.id.clone(),
            text,
            tokens,
            members: vec![record.id.clone()],
        });
        if let Some((_, second)) = time(record) {
            *self.times.entry(second).or_default() += 1;
        } else {
            self.unknown_times += 1;
        }
    }
    fn finish(
        self,
        limit: usize,
        tokens: bool,
        ctx: &ExecutionContext,
    ) -> Result<Vec<TextEvidence>> {
        if self.items.len() == 1 {
            return Ok(self.items);
        }
        let representative = &self.items[0];
        let range = match (self.times.first_key_value(), self.times.last_key_value()) {
            (Some((first, _)), Some((last, _))) => format!("{first} — {last}"),
            _ => "未知，不推断时间或频率".into(),
        };
        let text = format!(
            "--- 聚合日志组 ---\n代表证据编号: {}\n原始记录数: {}\n时间范围: {}\n每秒次数: {}\n时间未知记录数: {}\n以下为一条完整代表记录；其他成员仅报告共同模板及统计。\n{}--- 聚合日志组结束 ---\n",
            representative.id,
            self.items.len(),
            range,
            serde_json::to_string(&self.times)?,
            self.unknown_times,
            representative.text,
        );
        // Reuse the original estimates computed during planning in both modes.
        // Byte mode still requires token savings: fewer UTF-8 bytes alone need
        // not mean fewer tokens (the wrapper may contain more non-ASCII text).
        let grouped_tokens = super::planning::estimated_tokens(&text, ctx)?.saturating_add(1);
        let original_tokens: usize = self.items.iter().map(|item| item.tokens).sum();
        let grouped = if tokens {
            grouped_tokens
        } else {
            text.len() + 1
        };
        let original = if tokens {
            original_tokens
        } else {
            self.items.iter().map(|item| item.text.len() + 1).sum()
        };
        // Small groups or long histograms may cost more: send originals in that case.
        if grouped > limit || grouped >= original || grouped_tokens >= original_tokens {
            return Ok(self.items);
        }
        Ok(vec![TextEvidence {
            id: representative.id.clone(),
            text,
            tokens: grouped_tokens,
            members: self.items.iter().map(|item| item.id.clone()).collect(),
        }])
    }
}

/// Time normalization is used only for grouping/statistics, never evidence fields.
/// Zone-less timestamps remain visibly zone-less; yearless auth times stay raw.
fn time(record: &Record) -> Option<(String, String)> {
    let RecordData::Log(log) = &record.data else {
        return None;
    };
    let value = record
        .timestamp
        .as_deref()
        .or_else(|| log.fields.get("time").map(String::as_str));
    if let Some(value) = value {
        if let Ok(time) = DateTime::parse_from_rfc3339(value)
            .or_else(|_| DateTime::parse_from_str(value, "%d/%b/%Y:%H:%M:%S %z"))
        {
            let time = time.with_timezone(&chrono::Utc);
            return Some((
                format!("utc:{}", time.timestamp().div_euclid(60)),
                time.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
            ));
        }
        let value = value.replace(',', ".");
        for format in [
            "%Y-%m-%d %H:%M:%S%.f UTC",
            "%Y-%m-%d %H:%M:%S%.f",
            "%Y-%m-%dT%H:%M:%S%.f",
            "%Y/%m/%d %H:%M:%S%.f",
            "%d-%b-%Y %H:%M:%S%.f",
            "%a %b %d %H:%M:%S%.f %Y",
        ] {
            if let Ok(time) = NaiveDateTime::parse_from_str(&value, format) {
                let suffix = if value.ends_with(" UTC") {
                    " UTC"
                } else {
                    "（原始无时区）"
                };
                return Some((
                    format!("{}{}", time.format("%Y-%m-%d %H:%M"), suffix),
                    format!("{}{}", time.format("%Y-%m-%d %H:%M:%S"), suffix),
                ));
            }
        }
        // Unsupported time strings cannot support per-second statistics.
        return None;
    }
    if log.category == "auth_text" {
        let prefix = auth_time().find(&record.raw)?.as_str().trim();
        // Yearless syslog timestamps cannot be turned into an absolute instant.
        let minute = prefix.rsplit_once(':')?.0;
        return Some((format!("syslog:{minute}"), format!("{prefix}（原始时间）")));
    }
    None
}
fn auth_time() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"^(?:[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\s+").unwrap())
}
fn fingerprint(record: &Record) -> Result<Option<[u8; 32]>> {
    let RecordData::Log(log) = &record.data else {
        return Ok(None);
    };
    let mut fields = log.fields.clone();
    let mut raw = record.raw.clone();
    if record.status == ParseStatus::Parsed {
        match log.category.as_str() {
            "web_access" | "web_error" | "application_log" => {
                if let Some(value) = fields.remove("time") {
                    // Keep unparsed portions (including Spring PIDs) in the key.
                    if let Some(offset) = raw.find(&value) {
                        raw.replace_range(offset..offset + value.len(), "<时间>");
                    }
                }
            }
            "windows_event" => {
                for name in [
                    "Event.System.TimeCreated.#attributes.SystemTime",
                    "Event.System.EventRecordID",
                    "Event.System.EventRecordID.#text",
                ] {
                    fields.remove(name);
                }
                // EVTX raw JSON and flattened fields carry the same event data.
                raw.clear();
            }
            "auth_text" => {
                raw = auth_time().replace(&raw, "<时间> ").into_owned();
            }
            _ => {}
        }
    }
    let bucket = time(record).map(|(bucket, _)| bucket).or_else(|| {
        record
            .timestamp
            .clone()
            .or_else(|| log.fields.get("time").cloned())
    });
    let canonical = serde_json::to_vec(&(
        &record.source_id,
        &record.status,
        &log.category,
        &fields,
        &raw,
        bucket,
    ))?;
    Ok(Some(Sha256::digest(canonical).into()))
}

pub(super) struct Aggregator {
    limit: usize,
    tokens: bool,
    groups: Vec<Group>,
    index: HashMap<[u8; 32], usize>,
    records: usize,
    bytes: usize,
}
impl Aggregator {
    pub fn new(limit: usize, tokens: bool) -> Self {
        Self {
            limit,
            tokens,
            groups: Vec::new(),
            index: HashMap::new(),
            records: 0,
            bytes: 0,
        }
    }
    pub fn push(
        &mut self,
        record: &Record,
        text: String,
        tokens: usize,
        ctx: &ExecutionContext,
        emit: &mut impl FnMut(TextEvidence) -> Result<()>,
    ) -> Result<()> {
        ctx.check()?;
        if self.records >= WINDOW_RECORDS || self.bytes.saturating_add(text.len()) > WINDOW_BYTES {
            self.flush(ctx, emit)?;
        }
        self.records += 1;
        self.bytes = self.bytes.saturating_add(text.len());
        let key = fingerprint(record)?;
        if let Some(index) = key.as_ref().and_then(|key| self.index.get(key)).copied() {
            self.groups[index].add(record, text, tokens);
        } else {
            if let Some(key) = key {
                self.index.insert(key, self.groups.len());
            }
            self.groups.push(Group::new(record, text, tokens));
        }
        Ok(())
    }
    pub fn flush(
        &mut self,
        ctx: &ExecutionContext,
        emit: &mut impl FnMut(TextEvidence) -> Result<()>,
    ) -> Result<()> {
        for group in self.groups.drain(..) {
            ctx.check()?;
            for item in group.finish(self.limit, self.tokens, ctx)? {
                emit(item)?;
            }
        }
        self.index.clear();
        self.records = 0;
        self.bytes = 0;
        Ok(())
    }
}

/// Only referenced groups are retained for synthesis. Responses keep the short
/// representative reference until all API calls finish; persisted references are
/// expanded back to real evidence IDs without changing the report schema.
#[derive(Default)]
pub(super) struct References(HashMap<String, Vec<String>>);
impl References {
    pub fn retain(&mut self, batch: &[TextEvidence], response: &AiResponse) {
        let referenced: HashSet<_> = response
            .findings
            .iter()
            .chain(&response.context)
            .flat_map(|f| f.evidence_ids.iter())
            .collect();
        for item in batch {
            if item.members.len() > 1 && referenced.contains(&item.id) {
                self.0.insert(item.id.clone(), item.members.clone());
            }
        }
    }
    pub fn expand(&self, ids: &mut Vec<String>) {
        let mut seen = HashSet::new();
        *ids = ids
            .iter()
            .flat_map(|id| {
                self.0
                    .get(id)
                    .map_or_else(|| std::slice::from_ref(id), Vec::as_slice)
            })
            .filter(|id| seen.insert((*id).clone()))
            .cloned()
            .collect();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ingest::{IngestOptions, InputFormat, ingest_bytes, make_record, source_for};

    fn logs(count: usize) -> AnalysisReport {
        let text = (0..count).map(|i| format!(
            "192.0.2.10 - root [04/Nov/2026:10:{:02}:{:02} +0800] \"GET /login?user=root HTTP/1.1\" 401 100\n", i / 60, i % 60
        )).collect::<String>();
        ingest_bytes(
            "host-a/access.log",
            text.as_bytes(),
            &IngestOptions {
                format: InputFormat::Web,
                ..Default::default()
            },
        )
        .unwrap()
    }
    fn prepare(records: &[Record], enabled: bool, streamed: bool) -> PreparedAi {
        let config = AiConfig {
            aggregate_similar: enabled,
            ..Default::default()
        };
        let references: Vec<_> = records.iter().collect();
        if streamed {
            prepare_stream_with_context(
                &config,
                false,
                system_prompt(&references, false),
                records.len(),
                &ExecutionContext::default(),
                |visit| {
                    for record in records {
                        visit(record)?;
                    }
                    Ok(())
                },
            )
            .unwrap()
        } else {
            prepare_with_context(&references, &config, false, &ExecutionContext::default()).unwrap()
        }
    }
    #[test]
    fn repeated_requests_keep_minute_boundaries_histograms_and_all_members() {
        let report = logs(120);
        let prepared = prepare(&report.records, true, false);
        assert_eq!(prepared.plan.selected_records, 120);
        assert_eq!(prepared.plan.transmitted_records, 2);
        assert_eq!(prepared.plan.aggregated_groups, 2);
        assert!(prepared.plan.evidence_tokens < prepared.plan.original_evidence_tokens / 2);
        let batch = &prepared.batches[0];
        assert_eq!(batch[0].members.len(), 60);
        assert!(batch[0].text.contains("原始记录数: 60"));
        assert!(batch[0].text.contains("2026-11-04T02:00:59Z"));
        assert!(!batch[0].text.contains(&report.records[1].id));
        assert!(batch[0].text.contains("/login?user=root"));
        let ungrouped = prepare(&report.records, false, false);
        assert_eq!(ungrouped.plan.transmitted_records, 120);
        assert_eq!(ungrouped.plan.aggregated_groups, 0);
        assert_eq!(
            ungrouped.plan.evidence_tokens,
            ungrouped.plan.original_evidence_tokens
        );
        let streamed = prepare(&report.records, true, true);
        let disk = streamed.spool.as_ref().unwrap().batch(0).unwrap();
        assert_eq!(disk[0].text, batch[0].text);
        assert_eq!(disk[0].members, batch[0].members);
        assert_eq!(streamed.plan.evidence_tokens, prepared.plan.evidence_tokens);
        // Byte mode uses the same cached estimates and grouping when its byte
        // budget is sufficient, including after serializing to the local spool.
        let refs: Vec<_> = report.records.iter().collect();
        let config = AiConfig {
            context_tokens: None,
            batch_bytes: 10_000,
            ..Default::default()
        };
        let legacy = prepare_stream_with_context(
            &config,
            false,
            system_prompt(&refs, false),
            refs.len(),
            &ExecutionContext::default(),
            |visit| {
                for record in &report.records {
                    visit(record)?;
                }
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(
            legacy.plan.transmitted_records,
            prepared.plan.transmitted_records
        );
        assert_eq!(legacy.plan.evidence_tokens, prepared.plan.evidence_tokens);
        assert_eq!(
            legacy.plan.original_evidence_tokens,
            prepared.plan.original_evidence_tokens
        );
    }
    #[test]
    fn key_retains_security_fields_source_status_and_raw_unparsed_content() {
        let record = logs(1).records.remove(0);
        let key = fingerprint(&record).unwrap();
        for field in [
            "client_ip",
            "user",
            "request",
            "status",
            "bytes",
            "command",
            "host",
            "thread",
        ] {
            let mut changed = record.clone();
            let RecordData::Log(log) = &mut changed.data else {
                unreachable!()
            };
            log.fields.insert(field.into(), "different".into());
            assert_ne!(key, fingerprint(&changed).unwrap(), "{field}");
        }
        let mut changed = record.clone();
        changed.source_id = "host-b".into();
        assert_ne!(key, fingerprint(&changed).unwrap());
        changed = record.clone();
        changed.status = ParseStatus::Malformed;
        assert_ne!(key, fingerprint(&changed).unwrap());
        changed = record.clone();
        changed.raw.push_str(" extra malicious command");
        assert_ne!(key, fingerprint(&changed).unwrap());
    }
    #[test]
    fn auth_only_removes_known_time_prefixes_preserving_pid_port_and_success() {
        let source = source_for("auth.log", "text", b"synthetic");
        let record = |line: &str| {
            make_record(
                &source,
                "line:1".into(),
                None,
                line.into(),
                ParseStatus::Parsed,
                RecordData::Log(LogData {
                    category: "auth_text".into(),
                    fields: BTreeMap::new(),
                }),
            )
        };
        let original = record(
            "Nov  4 10:00:01 server sshd[42]: Failed password for root from 192.0.2.10 port 1234 ssh2",
        );
        let key = fingerprint(&original).unwrap();
        let later = record(&original.raw.replace("10:00:01", "10:00:02"));
        assert_eq!(key, fingerprint(&later).unwrap());
        for (old, new) in [
            ("root", "admin"),
            ("Failed password", "Accepted password"),
            ("192.0.2.10", "192.0.2.11"),
            ("[42]", "[43]"),
            ("1234", "1235"),
            ("10:00:01", "10:01:01"),
        ] {
            assert_ne!(
                key,
                fingerprint(&record(&original.raw.replace(old, new))).unwrap()
            );
        }
        assert!(time(&original).unwrap().1.contains("原始时间"));
        let mut unknown = original.clone();
        unknown.raw = "unsupported timestamp".into();
        assert!(time(&unknown).is_none());
    }
    #[test]
    fn evtx_ignores_only_record_number_and_time_not_process_or_login_identity() {
        let mut record = logs(1).records.remove(0);
        let RecordData::Log(log) = &mut record.data else {
            unreachable!()
        };
        log.category = "windows_event".into();
        log.fields
            .insert("Event.System.EventRecordID".into(), "1".into());
        log.fields.insert(
            "Event.System.TimeCreated.#attributes.SystemTime".into(),
            "2026-11-04T02:00:00Z".into(),
        );
        let key = fingerprint(&record).unwrap();
        let mut changed = record.clone();
        changed.timestamp = Some("2026-11-04T02:00:20Z".into());
        changed.raw = "different serialized timestamp".into();
        let RecordData::Log(log) = &mut changed.data else {
            unreachable!()
        };
        log.fields
            .insert("Event.System.EventRecordID".into(), "2".into());
        log.fields.insert(
            "Event.System.TimeCreated.#attributes.SystemTime".into(),
            "2026-11-04T02:00:20Z".into(),
        );
        assert_eq!(key, fingerprint(&changed).unwrap());
        let RecordData::Log(log) = &mut changed.data else {
            unreachable!()
        };
        log.fields.insert(
            "Event.System.Execution.#attributes.ProcessID".into(),
            "99".into(),
        );
        assert_ne!(key, fingerprint(&changed).unwrap());
    }
    #[test]
    fn small_budget_falls_back_to_full_records_and_windows_bound_repetition() {
        let mut records = logs(60).records;
        let refs: Vec<_> = records.iter().collect();
        let config = AiConfig {
            context_tokens: None,
            batch_bytes: 1000,
            ..Default::default()
        };
        let prepared =
            prepare_with_context(&refs, &config, false, &ExecutionContext::default()).unwrap();
        assert_eq!(prepared.plan.transmitted_records, 60);
        assert_eq!(prepared.plan.aggregated_groups, 0);
        for (i, record) in records.iter_mut().enumerate() {
            record.id = format!("first:{i}");
        }
        let template = records[0].clone();
        let records: Vec<_> = (0..3000)
            .map(|i| {
                let mut record = template.clone();
                record.id = format!("bounded:{i}");
                record
            })
            .collect();
        let prepared = prepare(&records, true, true);
        assert_eq!(prepared.plan.transmitted_records, 3);
        assert_eq!(
            prepared
                .spool
                .unwrap()
                .batch(0)
                .unwrap()
                .iter()
                .map(|item| item.members.len())
                .sum::<usize>(),
            3000
        );
    }
    #[test]
    fn packet_process_and_cancellation_do_not_lose_evidence_or_leak_payload() {
        let mut record = logs(1).records.remove(0);
        record.data = RecordData::Packet(PacketData {
            payload_hex: "secret".into(),
            ..Default::default()
        });
        assert!(fingerprint(&record).unwrap().is_none());
        let prepared = prepare(&[record.clone(), record], true, true);
        assert_eq!(prepared.plan.transmitted_records, 2);
        assert!(
            !prepared.spool.unwrap().batch(0).unwrap()[0]
                .text
                .contains("secret")
        );
        let records = logs(30).records;
        let ctx = ExecutionContext::default();
        let result = prepare_stream_with_context(
            &AiConfig::default(),
            false,
            "test".into(),
            records.len(),
            &ctx,
            |visit| {
                for (i, record) in records.iter().enumerate() {
                    if i == 10 {
                        ctx.cancellation.cancel();
                    }
                    visit(record)?;
                }
                Ok(())
            },
        );
        assert!(result.is_err_and(|e| crate::execution::is_cancelled(&e)));
    }
}
