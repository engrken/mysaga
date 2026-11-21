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

from api.iso_export import build_iso_workbook


def sample_logo() -> str:
    image = PillowImage.new("RGB", (400, 540), "white")
    draw = ImageDraw.Draw(image)
    draw.ellipse((130, 20, 270, 160), outline="black", width=5)
    draw.text((32, 365), "FILAMER CHRISTIAN UNIVERSITY, INC.", fill="black")
    draw.text((110, 430), "Roxas City, Capiz", fill="black")
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
                "eomsTitle": "EDUCATIONAL ORGANIZATION MANAGEMENT SYSTEM (ISO 21001:2025)",
                "affiliationLine1": "Member Association of Christian Schools, Colleges and Universities-Accrediting Council, Inc. (ACSCU-ACI)",
                "affiliationLine2": "Member: Association of Christian Schools, Colleges in Asia (ACUCA)",
                "submittedBy": "Teacher Example",
                "deanName": "Dean Example",
            },
            "class": {
                "courseCode": "ECE-16",
                "courseTitle": "Digital Systems",
                "id": "subject-class-123",
                "semester": "First Semester",
                "academicYear": "2026-2027",
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
            "rows": [[1, "Sample Student", 45, 19, 45.5, 90.25, "1.50", "PASSED"]],
            "logoPngBase64": sample_logo(),
        }

    def test_exact_fcu_header_grid_accreditation_and_page_setup(self):
        workbook_bytes = build_iso_workbook(self.payload)
        workbook = load_workbook(BytesIO(workbook_bytes))
        sheet = workbook["ISO Grading Sheet"]

        self.assertIn("A1:A4", {str(item) for item in sheet.merged_cells.ranges})
        self.assertIn("C1:E1", {str(item) for item in sheet.merged_cells.ranges})
        self.assertIn("C2:E2", {str(item) for item in sheet.merged_cells.ranges})
        self.assertIn("C3:E3", {str(item) for item in sheet.merged_cells.ranges})
        self.assertIn("B4:E4", {str(item) for item in sheet.merged_cells.ranges})
        self.assertIn("A5:G5", {str(item) for item in sheet.merged_cells.ranges})
        self.assertIn("A6:G6", {str(item) for item in sheet.merged_cells.ranges})

        self.assertEqual(sheet["B1"].value, "Form Name:")
        self.assertEqual(sheet["C1"].value, "FILAMER CHRISTIAN UNIVERSITY, INC.")
        self.assertEqual(sheet["B2"].value, "Form Name:")
        self.assertEqual(sheet["C2"].value, "COLLEGIATE GRADING SHEET")
        self.assertEqual(sheet["C2"].font.sz, 11)
        self.assertTrue(sheet["C2"].font.bold)
        self.assertEqual(sheet["B3"].value, "Form No: FCU-EOMS-RO-006-F")
        self.assertEqual(sheet["C3"].value, "EDUCATIONAL ORGANIZATION MANAGEMENT SYSTEM (ISO 21001:2025)")
        self.assertEqual(sheet["B4"].value, "Revision No. 1")
        self.assertEqual(sheet["F1"].value, "Effectivity:")
        self.assertEqual(sheet["G1"].value, "October 1, 2025")
        self.assertEqual(sheet["F2"].value, "Issuing Office:")
        self.assertEqual(sheet["G2"].value, "REGISTRAR'S OFFICE")
        self.assertEqual(sheet["F3"].value, "Page No.")
        self.assertEqual(sheet["G3"].value, 1)

        self.assertEqual(sheet["A5"].value, self.payload["header"]["affiliationLine1"])
        self.assertEqual(sheet["A6"].value, self.payload["header"]["affiliationLine2"])
        self.assertEqual(sheet["A5"].font.sz, 8)
        self.assertEqual(sheet["A6"].font.sz, 8)
        self.assertEqual(sheet["A5"].alignment.horizontal, "center")
        self.assertIsNone(sheet["A5"].border.left.style)
        self.assertIsNone(sheet["A6"].border.bottom.style)

        for row in range(1, 5):
            self.assertEqual(sheet.cell(row, 2).border.top.style, "thin")
        self.assertEqual(sheet["A1"].border.left.style, "thin")
        self.assertEqual(sheet["G4"].border.right.style, "thin")
        self.assertEqual(sheet["B1"].border.bottom.style, "thin")
        self.assertEqual(sheet["F2"].border.right.style, "thin")

        self.assertTrue(sheet.sheet_view.showGridLines)
        self.assertEqual(sheet.page_setup.orientation, "portrait")
        self.assertEqual(sheet.page_setup.paperSize, "14")
        self.assertEqual(sheet.page_setup.fitToWidth, 1)
        self.assertEqual(sheet.page_setup.fitToHeight, 0)
        self.assertTrue(sheet.sheet_properties.pageSetUpPr.fitToPage)
        self.assertEqual(len(sheet._images), 1)

    def test_dynamic_class_metadata_and_row_eleven_grade_grid(self):
        workbook_bytes = build_iso_workbook(self.payload)
        workbook = load_workbook(BytesIO(workbook_bytes))
        sheet = workbook.active

        self.assertIn("A7:B7", {str(item) for item in sheet.merged_cells.ranges})
        self.assertIn("C7:H7", {str(item) for item in sheet.merged_cells.ranges})
        self.assertIn("A8:B8", {str(item) for item in sheet.merged_cells.ranges})
        self.assertIn("C8:D8", {str(item) for item in sheet.merged_cells.ranges})
        self.assertIn("E8:H8", {str(item) for item in sheet.merged_cells.ranges})
        self.assertEqual(sheet["A7"].value, "Course No.: ECE-16")
        self.assertEqual(sheet["C7"].value, "Descriptive Title: Digital Systems")
        self.assertEqual(sheet["A8"].value, "Class ID: subject-class-123")
        self.assertEqual(sheet["C8"].value, "Semester: First Semester")
        self.assertEqual(sheet["E8"].value, "Academic Year: 2026-2027")
        self.assertEqual(sheet["A8"].border.bottom.style, "medium")
        self.assertEqual(sheet["H8"].border.bottom.style, "medium")

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
        self.assertEqual(sheet["F12"].value, 90.25)
        self.assertNotIn("Student Number", [sheet.cell(11, col).value for col in range(1, sheet.max_column + 1)])

        self.assertEqual(sheet.column_dimensions["A"].width, 6)
        self.assertEqual(sheet.column_dimensions["B"].width, 32)
        self.assertEqual(sheet.column_dimensions["C"].width, 10)
        self.assertEqual(sheet.column_dimensions["E"].width, 12)
        self.assertEqual(sheet.column_dimensions["F"].width, 14)
        self.assertEqual(sheet.column_dimensions["G"].width, 12)
        self.assertEqual(sheet.column_dimensions["H"].width, 12)
        self.assertEqual(sheet["A14"].value, "Submitted by:")
        self.assertEqual(sheet["A15"].value, "Teacher Example")
        self.assertEqual(sheet["E14"].value, "Noted:")
        self.assertEqual(sheet["E15"].value, "Dean Example")
        self.assertEqual(sheet["A15"].border.bottom.style, "thin")
        self.assertEqual(sheet["E15"].border.bottom.style, "thin")
        self.assertEqual(sheet.freeze_panes, "A12")
        self.assertEqual(sheet.print_title_rows, "11:11")

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
