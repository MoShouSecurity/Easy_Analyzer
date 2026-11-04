"""Keep parameter overrides from silently weakening the container checks."""
import unittest

from check_response_commands_linux import replace_assignment


class AssignmentOverrideTest(unittest.TestCase):
    def test_replaces_exactly_one_assignment_and_preserves_other_lines(self):
        source = '# EVIDENCE_DIR=comment\nSOURCE_LOG="/var/log/auth.log"\nEVIDENCE_DIR="./new"\n'
        changed = replace_assignment(source, 'EVIDENCE_DIR', '/tmp/existing')
        self.assertEqual(
            changed,
            '# EVIDENCE_DIR=comment\nSOURCE_LOG="/var/log/auth.log"\nEVIDENCE_DIR=/tmp/existing\n',
        )

    def test_missing_or_reformatted_assignment_fails(self):
        for source in ['SOURCE_LOG=/tmp/input\n', 'export EVIDENCE_DIR=./new\n']:
            with self.subTest(source=source), self.assertRaisesRegex(ValueError, 'found 0'):
                replace_assignment(source, 'EVIDENCE_DIR', '/tmp/existing')

    def test_duplicate_assignment_fails(self):
        source = 'SOURCE_LOG=/tmp/first\nSOURCE_LOG=/tmp/second\n'
        with self.assertRaisesRegex(ValueError, 'found 2'):
            replace_assignment(source, 'SOURCE_LOG', '/tmp/input')


if __name__ == '__main__':
    unittest.main()
