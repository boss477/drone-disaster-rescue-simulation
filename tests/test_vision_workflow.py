import unittest

from vision_workflow import candidate_ready, parse_class_ids, release_allowed, source_label


class VisionWorkflowTests(unittest.TestCase):
    def test_candidate_requires_full_streak(self):
        self.assertFalse(candidate_ready(14, 15))
        self.assertTrue(candidate_ready(15, 15))

    def test_release_requires_every_gate(self):
        for confirmed, enabled, connected in (
            (False, True, True),
            (True, False, True),
            (True, True, False),
        ):
            self.assertFalse(release_allowed(candidate_confirmed=confirmed, hardware_enabled=enabled,
                                             serial_connected=connected))
        self.assertTrue(release_allowed(candidate_confirmed=True, hardware_enabled=True,
                                        serial_connected=True))

    def test_source_is_explicit(self):
        self.assertEqual(source_label("sample.mp4", 0), "recorded:sample.mp4")
        self.assertEqual(source_label(None, 2), "camera:2")

    def test_model_class_list_is_parsed_and_deduplicated(self):
        self.assertEqual(parse_class_ids("0, 1,0"), [0, 1])
        with self.assertRaises(ValueError):
            parse_class_ids("")
        with self.assertRaises(ValueError):
            parse_class_ids("-1")


if __name__ == "__main__":
    unittest.main()
