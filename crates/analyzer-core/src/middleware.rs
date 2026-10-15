//! Common Tomcat JUL, Logback/Log4j and Spring text logs.
use regex::Regex;
use std::collections::BTreeMap;

pub(crate) struct ApplicationLogParser(Regex);
impl Default for ApplicationLogParser {
    fn default() -> Self {
        Self(Regex::new(concat!(
            r"^(?P<time>(?:\d{4}-\d{2}-\d{2}[T ]|\d{2}-[A-Za-z]{3}-\d{4} )",
            r"\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\s+",
            r"(?:\[(?P<pre_thread>[^\]]+)\]\s+)?",
            r"(?P<level>TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|SEVERE|CONFIG|FINE|FINER|FINEST)\s+",
            r"(?:\d+\s+(?:---\s+)?)?(?:\[(?P<thread>[^\]]+)\]\s+)?",
            r"(?P<logger>[A-Za-z_$][A-Za-z0-9_.$/-]*)\s+(?:[-:]\s*)?(?P<message>.*)$"
        )).unwrap())
    }
}
impl ApplicationLogParser {
    pub(crate) fn parse(&self, line: &str) -> Option<BTreeMap<String, String>> {
        let captures = self.0.captures(line)?;
        let mut fields = ["time", "level", "logger", "message"]
            .into_iter()
            .map(|key| (key.to_string(), captures[key].to_string()))
            .collect::<BTreeMap<_, _>>();
        if let Some(thread) = captures
            .name("thread")
            .or_else(|| captures.name("pre_thread"))
        {
            fields.insert("thread".into(), thread.as_str().into());
        }
        Some(fields)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tomcat_jul_logback_log4j_and_spring_keep_fields_and_raw_time() {
        let parser = ApplicationLogParser::default();
        for (line, time, level, thread) in [
            (
                "14-Oct-2026 09:30:01.123 SEVERE [http-nio-8080-exec-1] org.apache.catalina.core.StandardWrapperValve.invoke Servlet failure",
                "14-Oct-2026 09:30:01.123",
                "SEVERE",
                "http-nio-8080-exec-1",
            ),
            (
                "2026-10-14 09:30:01,123 ERROR [main] org.example.App - Startup failure",
                "2026-10-14 09:30:01,123",
                "ERROR",
                "main",
            ),
            (
                "2026-10-14 09:30:01.123 [worker-1] WARN org.example.App - Slow request",
                "2026-10-14 09:30:01.123",
                "WARN",
                "worker-1",
            ),
            (
                "2026-10-14T09:30:01.123+08:00 INFO 123 --- [main] org.example.App : Started",
                "2026-10-14T09:30:01.123+08:00",
                "INFO",
                "main",
            ),
        ] {
            let fields = parser.parse(line).unwrap();
            assert_eq!(fields["time"], time);
            assert_eq!(fields["level"], level);
            assert_eq!(fields["thread"], thread);
            assert!(fields["logger"].starts_with("org."));
        }
        assert!(
            parser
                .parse("\tat org.example.App.main(App.java:12)")
                .is_none()
        );
        assert!(parser.parse("ordinary text INFO example").is_none());
    }
}
