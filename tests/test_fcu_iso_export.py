import base64
import sys
import unittest
from io import BytesIO
from pathlib import Path

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
            "headers": ["No.", "Student Name", "Student Number", "Quiz 1", "Lecture (%)", "TOTAL GRADE (%)", "FINAL GRADE", "REMARKS"],
            "rows": [[1, "Sample Student", "2023-0001", 95, 45.5, 90.25, "1.50", "PASSED"]],
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

    def test_student_data_borders_adaptive_widths_and_signature_underline(self):
        workbook = load_workbook(BytesIO(build_iso_workbook(self.payload)))
        sheet = workbook.active
        self.assertEqual(sheet["A8"].value, "No.")
        self.assertEqual(sheet["B8"].value, "Student Name")
        self.assertEqual(sheet["B9"].value, "Sample Student")
        self.assertEqual(sheet["D9"].value, 95)
        self.assertEqual(sheet["F9"].value, 90.25)
        self.assertEqual(sheet["B9"].border.left.style, "thin")
        self.assertEqual(sheet["B9"].border.bottom.style, "thin")
        self.assertGreaterEqual(sheet.column_dimensions["B"].width, 30)
        self.assertEqual(sheet["A11"].value, "Submitted by:")
        self.assertEqual(sheet["A12"].value, "Teacher Example")
        self.assertEqual(sheet["E11"].value, "Noted:")
        self.assertEqual(sheet["E12"].value, "Dean Example")
        self.assertEqual(sheet["A12"].border.bottom.style, "thin")
        self.assertEqual(sheet["E12"].border.bottom.style, "thin")


if __name__ == "__main__":
    unittest.main()
