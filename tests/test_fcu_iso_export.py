import base64
import sys
import unittest
import zipfile
from io import BytesIO
from pathlib import Path
from xml.etree import ElementTree

from PIL import Image as PillowImage, ImageDraw
from openpyxl import load_workbook
from openpyxl.utils.units import pixels_to_EMU

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from api.iso_export import build_iso_workbook, _short_assessment_header, _normalize_export_remark


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
                "teacherName": "A different teacher from shared metadata",
                "notedByName": "A different shared school signatory",
            },
            "headers": ["NO.", "NAME OF STUDENTS", "EQ", "60%", "EQ", "40%", "TG", "FG", "REMARKS"],
            "rows": [[1, "Sample Student", 71.39, 42.83, 89.5, 35.8, 78.63, "2.75", "PASSED"]],
            "headerGroups": [
                {"startColumn": 3, "endColumn": 4, "title": "LECT. 60%"},
                {"startColumn": 5, "endColumn": 6, "title": "LAB. 40%"},
            ],
            "rowSpanColumns": [1, 2, 7, 8, 9],
            "numericColumns": [3, 4, 5, 6, 7],
            "logoPngBase64": sample_logo(),
        }

    def test_exact_fcu_header_grid_accreditation_and_page_setup(self):
        workbook_bytes = build_iso_workbook(self.payload)
        workbook = load_workbook(BytesIO(workbook_bytes), rich_text=True)
        sheet = workbook["ISO Grading Sheet"]

        merged = {str(item) for item in sheet.merged_cells.ranges}
        self.assertIn("A1:A4", merged)
        self.assertIn("B1:B4", merged)
        self.assertIn("C1:G1", merged)
        self.assertIn("C2:G2", merged)
        self.assertIn("C3:G3", merged)
        self.assertIn("C4:G4", merged)
        self.assertIn("A5:I5", merged)
        self.assertIn("A6:I6", merged)

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
        self.assertEqual(sheet["H2"].value, "Effectivity:")
        self.assertEqual(sheet["I2"].value, "October 1, 2025")
        self.assertEqual(sheet["H3"].value, "Issuing Office:")
        self.assertEqual(sheet["I3"].value, "REGISTRAR'S OFFICE")
        self.assertEqual(sheet["H4"].value, "Page No.")
        self.assertEqual(sheet["I4"].value, "1")
        for coordinate in ("H2", "I2", "H3", "I3", "H4", "I4"):
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
        self.assertIsNone(sheet["A5"].border.left)
        self.assertIsNone(sheet["A6"].border.bottom)
        self.assertIsNone(sheet["A1"].value, "the seal is the only A1:A4 content")

        # Validate the merged-cell perimeter: merged interiors carry only
        # the edges required by Excel, not four redundant borders per cell.
        for column in range(1, 10):
            self.assertEqual(sheet.cell(1, column).border.top.style, "thin")
            self.assertEqual(sheet.cell(4, column).border.bottom.style, "thin")
        for row in range(1, 5):
            for column in (1, 2, 3, 8):
                self.assertEqual(sheet.cell(row, column).border.left.style, "thin")
            for column in (1, 2, 7, 9):
                self.assertEqual(sheet.cell(row, column).border.right.style, "thin")
            for column in (8, 9):
                cell = sheet.cell(row, column)
                self.assertEqual(cell.border.top.style, "thin")
                self.assertEqual(cell.border.bottom.style, "thin")

        self.assertTrue(sheet.sheet_view.showGridLines)
        self.assertEqual(sheet.page_setup.orientation, "landscape")
        self.assertEqual(sheet.page_setup.paperSize, 14)
        self.assertEqual(sheet.page_setup.fitToWidth, 1)
        self.assertEqual(sheet.page_setup.fitToHeight, 0)
        self.assertTrue(sheet.sheet_properties.pageSetUpPr.fitToPage)
        self.assertEqual(len(sheet._images), 1)
        # openpyxl reports the source PNG size as image.width/height.
        # The drawing anchor extent is the actual displayed size in Excel.
        self.assertEqual(sheet._images[0].anchor.ext.cx, pixels_to_EMU(80))
        self.assertEqual(sheet._images[0].anchor.ext.cy, 80 * 9525)
        self.assertEqual(sheet._images[0].anchor._from.col, 0)
        self.assertEqual(sheet._images[0].anchor._from.row, 0)
        self.assertGreater(sheet._images[0].anchor._from.colOff, 0)
        self.assertGreater(sheet._images[0].anchor._from.rowOff, 0)

    def test_dynamic_class_metadata_and_two_tier_domain_summary(self):
        sheet = load_workbook(BytesIO(build_iso_workbook(self.payload))).active
        merged = {str(item) for item in sheet.merged_cells.ranges}
        self.assertIn("D7:G7", merged)
        self.assertEqual(sheet["A7"].value, "Course No.")
        self.assertEqual(sheet["B7"].value, "ECE-16")
        self.assertEqual(sheet["D7"].value, "Digital Systems")
        self.assertEqual(sheet["A8"].value, "Class I.D.")
        self.assertEqual(sheet["B8"].value, "BSECE 4")
        self.assertEqual(sheet["D8"].value, "First Semester")
        self.assertEqual(sheet["F8"].value, "2026-2027")
        expected = {
            "A11": "NO.", "B11": "NAME OF STUDENTS", "C11": "LECT. 60%",
            "E11": "LAB. 40%", "G11": "TG", "H11": "FG", "I11": "REMARKS",
            "C12": "EQ", "D12": "60%", "E12": "EQ", "F12": "40%",
        }
        for cell, value in expected.items():
            self.assertEqual(sheet[cell].value, value)
        self.assertEqual(sheet["A13"].value, 1)
        self.assertEqual(sheet["B13"].value, "Sample Student")
        for cell, value in {"C13":71.39,"D13":42.83,"E13":89.5,"F13":35.8,"G13":78.63}.items():
            self.assertAlmostEqual(sheet[cell].value, value)
            self.assertEqual(sheet[cell].number_format, "0.00")
        self.assertEqual(sheet["H13"].value, "2.75")
        self.assertEqual(sheet["I13"].value, "PASSED")
        for merged_range in ("C11:D11","E11:F11","A11:A12","B11:B12","G11:G12","H11:H12","I11:I12"):
            self.assertIn(merged_range, merged)
        self.assertEqual(sheet.row_dimensions[11].height, 24)
        self.assertEqual(sheet.row_dimensions[12].height, 22)
        self.assertEqual(sheet["A15"].value, "Submitted by:")
        self.assertEqual(sheet["E15"].value, "Noted:")
        self.assertEqual(sheet["A19"].value, "DR. TEACHER EXAMPLE")
        self.assertEqual(sheet["E19"].value, "PROF. DEAN EXAMPLE")
        self.assertEqual(sheet["A20"].value, "Instructor")
        self.assertEqual(sheet["E20"].value, "Dean")
        self.assertIn("A15:D15", merged)
        self.assertIn("E15:I15", merged)
        self.assertIn("A19:D19", merged)
        self.assertIn("E19:I19", merged)
        self.assertEqual(sheet.column_dimensions["A"].width, 7)
        self.assertEqual(sheet.column_dimensions["B"].width, 32)
        self.assertEqual(sheet.column_dimensions["C"].width, 12)
        self.assertEqual(sheet.column_dimensions["G"].width, 12)
        # The rightmost two columns also host the ISO document-control metadata.
        self.assertEqual(sheet.column_dimensions["H"].width, 18)
        self.assertEqual(sheet.column_dimensions["I"].width, 22)
        self.assertEqual(sheet.freeze_panes, "A13")
        self.assertEqual(sheet.print_title_rows, "$11:$12")
    def test_header_and_accreditation_spans_follow_a_wide_active_table(self):
        payload = dict(self.payload)
        payload["headers"] = list(self.payload["headers"]) + [f"Assessment {index}" for index in range(1, 7)]
        payload["rows"] = [list(row) + [index for index in range(1, 7)] for row in self.payload["rows"]]

        sheet = load_workbook(BytesIO(build_iso_workbook(payload))).active
        merged = {str(item) for item in sheet.merged_cells.ranges}

        # N = 15: the centre block ends at M; the metadata grid occupies N:O.
        self.assertIn("A1:A4", merged)
        self.assertIn("B1:B4", merged)
        for row_number in range(1, 5):
            self.assertIn(f"C{row_number}:M{row_number}", merged)
        self.assertIn("A5:O5", merged)
        self.assertIn("A6:O6", merged)
        for row_number in range(15, 21):
            self.assertIn(f"A{row_number}:G{row_number}", merged)
            self.assertIn(f"H{row_number}:O{row_number}", merged)
        self.assertEqual(sheet["A15"].value, "Submitted by:")
        self.assertEqual(sheet["H15"].value, "Noted:")
        self.assertEqual(sheet["A19"].value, "DR. TEACHER EXAMPLE")
        self.assertEqual(sheet["H19"].value, "PROF. DEAN EXAMPLE")
        self.assertEqual(sheet["N2"].value, "Effectivity:")
        self.assertEqual(sheet["O2"].value, "October 1, 2025")
        self.assertEqual(sheet["N3"].value, "Issuing Office:")
        self.assertEqual(sheet["O3"].value, "REGISTRAR'S OFFICE")
        self.assertEqual(sheet["N4"].value, "Page No.")
        self.assertEqual(sheet["O4"].value, "1")
        self.assertEqual(sheet.column_dimensions["N"].width, 18)
        self.assertEqual(sheet.column_dimensions["O"].width, 22)

    def test_minimum_width_header_uses_columns_f_and_g_for_metadata(self):
        payload = dict(self.payload)
        payload["headers"] = list(self.payload["headers"][:7])
        payload["rows"] = [list(row[:7]) for row in self.payload["rows"]]
        payload.pop("headerGroups", None)
        payload.pop("rowSpanColumns", None)
        payload.pop("numericColumns", None)

        sheet = load_workbook(BytesIO(build_iso_workbook(payload))).active
        merged = {str(item) for item in sheet.merged_cells.ranges}
        self.assertIn("C1:E1", merged)
        self.assertIn("C4:E4", merged)
        self.assertIn("A5:G5", merged)
        self.assertIn("A6:G6", merged)
        self.assertEqual(sheet["F3"].value, "Issuing Office:")
        self.assertEqual(sheet["G3"].value, "REGISTRAR'S OFFICE")
        self.assertFalse(sheet["G3"].alignment.wrap_text)

    def test_component_headers_use_eq_and_percentage_only_and_remarks_use_short_codes(self):
        payload = dict(self.payload)
        payload["headers"] = [
            "NO.",
            "NAME OF STUDENTS",
            "MAJOR EXAM / MIDTERM EXAM\nEQ",
            "MAJOR EXAM / MIDTERM EXAM\n40.00%",
            "TOTAL GRADE (%)",
            "FINAL GRADE",
            "REMARKS",
        ]
        payload["rows"] = [
            [1, "Permit Student", 0.5, 0.2, 0.7, "1.00", "NO EXAMINATION PERMIT"],
            [2, "No Permit Alias Student", 0.5, 0.2, 0.7, "1.00", "NO PERMIT"],
            [3, "Incomplete Student", 0.5, 0.2, 0.7, "INC", "INCOMPLETE"],
            [4, "Dropped Student", 0.5, 0.2, 0.7, "DRP", "DROPPED"],
        ]
        payload.pop("headerGroups", None)
        payload.pop("rowSpanColumns", None)
        payload.pop("numericColumns", None)

        sheet = load_workbook(BytesIO(build_iso_workbook(payload))).active
        self.assertEqual(sheet["C11"].value, "MIDTERM EXAM\nEQ")
        self.assertEqual(sheet["D11"].value, "MIDTERM EXAM\n40.00%")
        self.assertEqual([sheet[f"G{row}"].value for row in range(12, 16)], ["NP", "NP", "INC", "DROPPED"])
        self.assertTrue(sheet["C11"].alignment.wrap_text)
        self.assertTrue(sheet["D11"].alignment.wrap_text)

    def test_only_no_examination_permit_aliases_normalize_to_np(self):
        self.assertEqual(_normalize_export_remark("NO EXAMINATION PERMIT"), "NP")
        self.assertEqual(_normalize_export_remark("NO PERMIT"), "NP")
        self.assertEqual(_normalize_export_remark("NO PRIVILEGE"), "NO PRIVILEGE")
        self.assertEqual(_normalize_export_remark("FAILED"), "FAILED")
        self.assertEqual(_normalize_export_remark("DROPPED"), "DROPPED")

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
        self.assertEqual(_short_assessment_header("MAJOR EXAM / MIDTERM EXAM\nEQ"), "MIDTERM EXAM\nEQ")
        self.assertEqual(_short_assessment_header("MAJOR EXAM / MIDTERM EXAM\n40.00%"), "MIDTERM EXAM\n40.00%")

    def test_migration_slug_is_never_written_as_the_human_readable_section_name(self):
        payload = dict(self.payload)
        payload["class"] = dict(self.payload["class"], classId="migration_2026_ece-16")
        workbook = load_workbook(BytesIO(build_iso_workbook(payload)))
        self.assertIsNone(workbook.active["B8"].value)

    def test_class_id_never_falls_back_to_section_or_subject_id(self):
        payload = dict(self.payload)
        payload["class"] = dict(self.payload["class"], classId=None, sectionName="BSECE 4", id="migration_2026_ece-16")
        workbook = load_workbook(BytesIO(build_iso_workbook(payload)))
        self.assertIsNone(workbook.active["B8"].value)

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
