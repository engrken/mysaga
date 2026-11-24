import base64
import sys
import unittest
import zipfile
from io import BytesIO
from pathlib import Path
from xml.etree import ElementTree

from PIL import Image as PillowImage, ImageDraw
from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from api.iso_export import build_iso_workbook, _short_assessment_header


def sample_logo() -> str:
    image = PillowImage.new("RGB", (160, 160), "white")
    draw = ImageDraw.Draw(image)
    draw.ellipse((8, 8, 152, 152), outline="black", width=5)
    output = BytesIO()
    image.save(output, format="PNG")
    return base64.b64encode(output.getvalue()).decode("ascii")


class FcuIsoExportTests(unittest.TestCase):
    def setUp(self):
        self.payload = {
            "filename": "ECE-16-iso-grading-sheet.xlsx",
            "sheetName": "ISO Grading Sheet",
            "header": {
                "organizationName": "FILAMER CHRISTIAN UNIVERSITY, INC.",
                "organizationAddress": "Roxas City, Capiz",
                "formName": "COLLEGIATE GRADING SHEET",
                "formNo": "FCU-EOMS-RO-006-F",
                "effectivity": "October 1, 2025",
                "issuingOffice": "REGISTRAR'S OFFICE",
                "revisionNo": "1",
                "eomsTitle": "EDUCATIONAL ORGANIZATION MANAGEMENT SYSTEM\nISO 21001:2025",
                "affiliationLine1": "Member: Association of Christian Schools, Colleges and Universities-Accrediting Council, Inc. (ACSCU-ACI)",
                "affiliationLine2": "Member: Association of Christian Schools, Colleges in Asia (ACUCA)",
                "submittedBy": "Dr. Teacher Example",
                "teacherPosition": "Instructor",
                "notedByName": "Prof. Dean Example",
                "notedByPosition": "Dean",
            },
            "class": {
                "courseCode": "ECE-16",
                "courseTitle": "Digital Systems",
                "id": "subject-class-123",
                "classId": "BSECE 4",
                "semester": "First Semester",
                "academicYear": "2026-2027",
                "sectionName": "BSECE 4",
                "teacherName": "Kenneth Mark D. Bulquerin",
                "notedByName": "prof. Dean Example",
            },
            "headers": [
                "NO.",
                "NAME OF STUDENTS",
                "Lecture / Major Examinations / Midterm Exam · Midterm Exam (Max 50)",
                "Lecture / Quizzes/Assignments · Quiz 1 (Max 20)",
                "Lecture (%)",
                "TOTAL GRADE (%)",
                "FINAL GRADE",
                "REMARKS",
            ],
            "rows": [[1, "Sample Student", 45, 19, 0.2226, 0.9025, "1.50", "PASSED"]],
            "logoPngBase64": sample_logo(),
        }

    def test_exact_fcu_header_grid_accreditation_and_page_setup(self):
        workbook_bytes = build_iso_workbook(self.payload)
        workbook = load_workbook(BytesIO(workbook_bytes), rich_text=True)
        sheet = workbook["ISO Grading Sheet"]

        merged = {str(item) for item in sheet.merged_cells.ranges}
        self.assertIn("A1:A4", merged)
        self.assertIn("B1:B4", merged)
        self.assertIn("C1:F1", merged)
        self.assertIn("C2:F2", merged)
        self.assertIn("C3:F3", merged)
        self.assertIn("C4:F4", merged)
        self.assertIn("A5:H5", merged)
        self.assertIn("A6:H6", merged)

        control_text = str(sheet["B1"].value)
        self.assertIn("FORM NAME:", control_text)
        self.assertIn("COLLEGIATE GRADING SHEET", control_text)
        self.assertIn("FORM NO.:", control_text)
        self.assertIn("FCU-EOMS-RO-006-F", control_text)
        self.assertIn("REVISION NO.: 1", control_text)

        identity = sheet["C1"].value
        self.assertEqual(str(identity), "FILAMER CHRISTIAN UNIVERSITY, INC.\nRoxas City, Capiz")
        self.assertEqual(identity[0].font.sz, 11)
        self.assertTrue(identity[0].font.b)
        self.assertEqual(identity[1].font.sz, 8.5)
        self.assertTrue(identity[1].font.i)
        self.assertEqual(sheet["C2"].value, "COLLEGIATE GRADING SHEET")
        self.assertEqual(sheet["C2"].font.sz, 11)
        self.assertTrue(sheet["C2"].font.bold)
        self.assertEqual(sheet["C3"].value, "EDUCATIONAL ORGANIZATION MANAGEMENT SYSTEM")
        self.assertEqual(sheet["C4"].value, "ISO 21001:2025")
        self.assertEqual(sheet["G2"].value, "Effectivity:")
        self.assertEqual(sheet["H2"].value, "October 1, 2025")
        self.assertEqual(sheet["G3"].value, "Issuing Office:")
        self.assertEqual(sheet["H3"].value, "REGISTRAR'S OFFICE")
        self.assertEqual(sheet["G4"].value, "Page No.")
        self.assertEqual(sheet["H4"].value, "1")
        for coordinate in ("G2", "H2", "G3", "H3", "G4", "H4"):
            self.assertFalse(sheet[coordinate].alignment.wrap_text)
            self.assertTrue(sheet[coordinate].alignment.shrink_to_fit)
        self.assertEqual(sheet.row_dimensions[1].height, 32)
        self.assertEqual(sheet.row_dimensions[2].height, 24)
        self.assertEqual(sheet.row_dimensions[3].height, 24)
        self.assertEqual(sheet.row_dimensions[4].height, 22)

        self.assertEqual(sheet["A5"].value, self.payload["header"]["affiliationLine1"])
        self.assertEqual(sheet["A6"].value, self.payload["header"]["affiliationLine2"])
        self.assertEqual(sheet["A5"].font.sz, 8)
        self.assertEqual(sheet["A6"].font.sz, 8)
        self.assertEqual(sheet["A5"].alignment.horizontal, "center")
        self.assertIsNone(sheet["A5"].border.left.style)
        self.assertIsNone(sheet["A6"].border.bottom.style)
        self.assertIsNone(sheet["A1"].value, "the seal is the only A1:A4 content")

        # Validate the merged-cell perimeter: merged interiors carry only
        # the edges required by Excel, not four redundant borders per cell.
        for column in range(1, 9):
            self.assertEqual(sheet.cell(1, column).border.top.style, "thin")
            self.assertEqual(sheet.cell(4, column).border.bottom.style, "thin")
        for row in range(1, 5):
            for column in (1, 2, 3, 6, 7, 8):
                cell = sheet.cell(row, column)
                self.assertEqual(cell.border.left.style, "thin")
                self.assertEqual(cell.border.right.style, "thin")
            for column in (7, 8):
                cell = sheet.cell(row, column)
                self.assertEqual(cell.border.top.style, "thin")
                self.assertEqual(cell.border.bottom.style, "thin")

        self.assertTrue(sheet.sheet_view.showGridLines)
        self.assertEqual(sheet.page_setup.orientation, "portrait")
        self.assertEqual(sheet.page_setup.paperSize, "14")
        self.assertEqual(sheet.page_setup.fitToWidth, 1)
        self.assertEqual(sheet.page_setup.fitToHeight, 0)
        self.assertTrue(sheet.sheet_properties.pageSetUpPr.fitToPage)
        self.assertEqual(len(sheet._images), 1)
        self.assertEqual(sheet._images[0].width, 80)
        self.assertEqual(sheet._images[0].height, 80)
        self.assertEqual(sheet._images[0].anchor._from.col, 0)
        self.assertEqual(sheet._images[0].anchor._from.row, 0)
        self.assertGreater(sheet._images[0].anchor._from.colOff, 0)
        self.assertGreater(sheet._images[0].anchor._from.rowOff, 0)

    def test_dynamic_class_metadata_and_row_eleven_grade_grid(self):
        workbook_bytes = build_iso_workbook(self.payload)
        workbook = load_workbook(BytesIO(workbook_bytes))
        sheet = workbook.active

        self.assertIn("D7:G7", {str(item) for item in sheet.merged_cells.ranges})
        self.assertEqual(sheet["A7"].value, "Course No.")
        self.assertEqual(sheet["B7"].value, "ECE-16")
        self.assertEqual(sheet["C7"].value, "Descriptive Title")
        self.assertEqual(sheet["D7"].value, "Digital Systems")
        self.assertEqual(sheet["A8"].value, "Class I.D.")
        self.assertEqual(sheet["B8"].value, "BSECE 4")
        self.assertEqual(sheet["C8"].value, "Semester")
        self.assertEqual(sheet["D8"].value, "First Semester")
        self.assertEqual(sheet["E8"].value, "Academic Year")
        self.assertEqual(sheet["F8"].value, "2026-2027")
        for column in range(1, 8):
            self.assertEqual(sheet.cell(8, column).border.bottom.style, "medium")

        self.assertEqual(sheet["A11"].value, "NO.")
        self.assertEqual(sheet["B11"].value, "NAME OF STUDENTS")
        self.assertEqual(sheet["C11"].value, "Midterm (50)")
        self.assertEqual(sheet["D11"].value, "Quiz 1 (20)")
        self.assertEqual(sheet["E11"].value, "Lecture (%)")
        self.assertEqual(sheet["F11"].value, "TOTAL GRADE (%)")
        self.assertEqual(sheet["G11"].value, "FINAL GRADE")
        self.assertEqual(sheet["H11"].value, "REMARKS")
        self.assertTrue(sheet["C11"].alignment.wrap_text)
        self.assertEqual(sheet.row_dimensions[11].height, 30)
        self.assertEqual(sheet["A12"].value, 1)
        self.assertEqual(sheet["B12"].value, "Sample Student")
        self.assertEqual(sheet["C12"].value, 45)
        self.assertEqual(sheet["D12"].value, 19)
        self.assertAlmostEqual(sheet["E12"].value, 0.2226)
        self.assertEqual(sheet["E12"].number_format, "0.00%")
        self.assertAlmostEqual(sheet["F12"].value, 0.9025)
        self.assertEqual(sheet["F12"].number_format, "0.00%")
        self.assertEqual(sheet["A18"].value, "KENNETH MARK D. BULQUERIN")
        self.assertEqual(sheet["E18"].value, "PROF. DEAN EXAMPLE")
        self.assertIn("A14:D14", {str(item) for item in sheet.merged_cells.ranges})
        self.assertIn("E14:H14", {str(item) for item in sheet.merged_cells.ranges})
        for row_number in (15, 16, 17):
            self.assertIn(f"A{row_number}:D{row_number}", {str(item) for item in sheet.merged_cells.ranges})
            self.assertIn(f"E{row_number}:H{row_number}", {str(item) for item in sheet.merged_cells.ranges})
            self.assertIsNone(sheet.cell(row_number, 1).value)
            self.assertIsNone(sheet.cell(row_number, 5).value)
            self.assertEqual(sheet.row_dimensions[row_number].height, 22)
        self.assertIn("A18:D18", {str(item) for item in sheet.merged_cells.ranges})
        self.assertIn("E18:H18", {str(item) for item in sheet.merged_cells.ranges})
        self.assertIn("A19:D19", {str(item) for item in sheet.merged_cells.ranges})
        self.assertIn("E19:H19", {str(item) for item in sheet.merged_cells.ranges})
        self.assertEqual(sheet["A19"].value, "Instructor")
        self.assertEqual(sheet["E19"].value, "Dean")
        for coordinate in ("A18", "E18"):
            self.assertEqual(sheet[coordinate].font.sz, 10)
            self.assertTrue(sheet[coordinate].font.bold)
            self.assertEqual(sheet[coordinate].alignment.horizontal, "center")
        for coordinate in ("A19", "E19"):
            self.assertEqual(sheet[coordinate].font.sz, 9)
            self.assertFalse(sheet[coordinate].font.bold)
            self.assertEqual(sheet[coordinate].alignment.horizontal, "center")
        self.assertNotIn("Student Number", [sheet.cell(11, col).value for col in range(1, sheet.max_column + 1)])

        self.assertEqual(sheet.column_dimensions["A"].width, 12)
        self.assertEqual(sheet.column_dimensions["B"].width, 32)
        self.assertEqual(sheet.column_dimensions["C"].width, 10)
        self.assertEqual(sheet.column_dimensions["E"].width, 12)
        self.assertEqual(sheet.column_dimensions["F"].width, 14)
        self.assertEqual(sheet.column_dimensions["G"].width, 18)
        self.assertEqual(sheet.column_dimensions["H"].width, 22)
        self.assertEqual(sheet["A14"].value, "Submitted by:")
        self.assertEqual(sheet["E14"].value, "Noted:")
        self.assertIsNone(sheet["A17"].border.bottom.style)
        self.assertIsNone(sheet["E17"].border.bottom.style)
        self.assertEqual(sheet.freeze_panes, "A12")
        self.assertEqual(sheet.print_title_rows, "11:11")

    def test_header_and_accreditation_spans_follow_a_wide_active_table(self):
        payload = dict(self.payload)
        payload["headers"] = list(self.payload["headers"]) + [f"Assessment {index}" for index in range(1, 7)]
        payload["rows"] = [list(row) + [index for index in range(1, 7)] for row in self.payload["rows"]]

        sheet = load_workbook(BytesIO(build_iso_workbook(payload))).active
        merged = {str(item) for item in sheet.merged_cells.ranges}

        # N = 14: the centre block ends at L; the metadata grid occupies M:N.
        self.assertIn("A1:A4", merged)
        self.assertIn("B1:B4", merged)
        for row_number in range(1, 5):
            self.assertIn(f"C{row_number}:L{row_number}", merged)
        self.assertIn("A5:N5", merged)
        self.assertIn("A6:N6", merged)
        for row_number in range(14, 20):
            self.assertIn(f"A{row_number}:G{row_number}", merged)
            self.assertIn(f"H{row_number}:N{row_number}", merged)
        self.assertEqual(sheet["A14"].value, "Submitted by:")
        self.assertEqual(sheet["H14"].value, "Noted:")
        self.assertEqual(sheet["A18"].value, "KENNETH MARK D. BULQUERIN")
        self.assertEqual(sheet["H18"].value, "PROF. DEAN EXAMPLE")
        self.assertEqual(sheet["M2"].value, "Effectivity:")
        self.assertEqual(sheet["N2"].value, "October 1, 2025")
        self.assertEqual(sheet["M3"].value, "Issuing Office:")
        self.assertEqual(sheet["N3"].value, "REGISTRAR'S OFFICE")
        self.assertEqual(sheet["M4"].value, "Page No.")
        self.assertEqual(sheet["N4"].value, "1")
        self.assertEqual(sheet.column_dimensions["M"].width, 18)
        self.assertEqual(sheet.column_dimensions["N"].width, 22)

    def test_minimum_width_header_uses_columns_f_and_g_for_metadata(self):
        payload = dict(self.payload)
        payload["headers"] = list(self.payload["headers"][:7])
        payload["rows"] = [list(row[:7]) for row in self.payload["rows"]]

        sheet = load_workbook(BytesIO(build_iso_workbook(payload))).active
        merged = {str(item) for item in sheet.merged_cells.ranges}
        self.assertIn("C1:E1", merged)
        self.assertIn("C4:E4", merged)
        self.assertIn("A5:G5", merged)
        self.assertIn("A6:G6", merged)
        self.assertEqual(sheet["F3"].value, "Issuing Office:")
        self.assertEqual(sheet["G3"].value, "REGISTRAR'S OFFICE")
        self.assertFalse(sheet["G3"].alignment.wrap_text)

    def test_activity_and_subtotal_headers_are_shortened_without_parent_paths(self):
        self.assertEqual(_short_assessment_header("Final Design / Design (%)"), "Design (%)")
        self.assertEqual(
            _short_assessment_header("Lecture / Major Examinations / Midterm Exam · Midterm Exam (Max 50)"),
            "Midterm (50)",
        )
        self.assertEqual(
            _short_assessment_header("Lecture / Quizzes/Assignments · Quiz 1 (Max 20)"),
            "Quiz 1 (20)",
        )

    def test_migration_slug_is_never_written_as_the_human_readable_section_name(self):
        payload = dict(self.payload)
        payload["class"] = dict(self.payload["class"], classId="migration_2026_ece-16")
        workbook = load_workbook(BytesIO(build_iso_workbook(payload)))
        self.assertEqual(workbook.active["B8"].value, "")

    def test_class_id_never_falls_back_to_section_or_subject_id(self):
        payload = dict(self.payload)
        payload["class"] = dict(self.payload["class"], classId=None, sectionName="BSECE 4", id="migration_2026_ece-16")
        workbook = load_workbook(BytesIO(build_iso_workbook(payload)))
        self.assertEqual(workbook.active["B8"].value, "")

    def test_every_sheet_xml_row_serializes_cells_in_column_order(self):
        workbook_bytes = build_iso_workbook(self.payload)
        with zipfile.ZipFile(BytesIO(workbook_bytes)) as archive:
            xml = archive.read("xl/worksheets/sheet1.xml")
        root = ElementTree.fromstring(xml)
        namespace = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
        for row in root.iter(namespace + "row"):
            columns = []
            for cell in row.findall(namespace + "c"):
                letters = "".join(char for char in cell.attrib["r"] if char.isalpha())
                index = 0
                for letter in letters:
                    index = index * 26 + ord(letter.upper()) - 64
                columns.append(index)
            self.assertEqual(columns, sorted(columns), f"cells in row {row.attrib.get('r')} must be A→Z ordered")
            self.assertEqual(len(columns), len(set(columns)), f"row {row.attrib.get('r')} must not repeat cell columns")



if __name__ == "__main__":
    unittest.main()
