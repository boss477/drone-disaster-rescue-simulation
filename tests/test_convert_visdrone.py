import unittest

import convert_visdrone as cv


class ConvertAnnotationTests(unittest.TestCase):
    def test_keeps_only_pedestrian_and_people(self):
        text = "10,20,30,40,1,1,0,0\n50,60,10,10,1,2,0,0\n0,0,5,5,1,4,0,0\n"
        lines = cv.convert_annotation(text, 100, 200)
        self.assertEqual([line.split()[0] for line in lines], ["0", "1"])

    def test_ignored_regions_dropped(self):
        self.assertEqual(cv.convert_annotation("10,20,30,40,0,1,0,0", 100, 200), [])

    def test_box_is_normalised_and_clipped(self):
        (line,) = cv.convert_annotation("90,0,30,20,1,1,0,0", 100, 100)  # runs past the right edge
        cls, cx, cy, w, h = line.split()
        self.assertEqual(cls, "0")
        self.assertAlmostEqual(float(cx), 0.95, places=5)
        self.assertAlmostEqual(float(w), 0.10, places=5)
        self.assertAlmostEqual(float(cy), 0.10, places=5)

    def test_malformed_and_empty_rows_skipped(self):
        self.assertEqual(cv.convert_annotation("\n1,2,3\n", 100, 100), [])


if __name__ == "__main__":
    unittest.main()
