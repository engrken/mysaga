"""FCU-EOMS-RO-006-F Excel exporter.

This is a Vercel Python Function at /api/iso_export. The Next.js route
authenticates the teacher, queries the official class records, calculates
grades server-side, and signs the payload before this function accepts it.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import time
from http.server import BaseHTTPRequestHandler
from io import BytesIO
from urllib.parse import urlsplit

from openpyxl import Workbook
from openpyxl.cell.rich_text import CellRichText, TextBlock
from openpyxl.cell.text import InlineFont
from openpyxl.drawing.image import Image as ExcelImage
from openpyxl.drawing.spreadsheet_drawing import AnchorMarker, OneCellAnchor
from openpyxl.drawing.xdr import XDRPositiveSize2D
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.worksheet.worksheet import Worksheet


MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
MAX_REQUEST_BYTES = 4_300_000
MAX_CLOCK_SKEW_SECONDS = 180
SIGNING_CONTEXT = b"SAGA-ISO-EXPORT-v1\n"

THIN_SIDE = Side(style="thin", color="FF000000")
THIN_BORDER = Border(left=THIN_SIDE, right=THIN_SIDE, top=THIN_SIDE, bottom=THIN_SIDE)
BOTTOM_BORDER = Border(bottom=THIN_SIDE)
MEDIUM_SIDE = Side(style="medium", color="FF000000")
METADATA_BOTTOM_BORDER = Border(bottom=MEDIUM_SIDE)
NO_BORDER = Border()


def _safe_text(value: object, fallback: str = "") -> str:
    text = str(value if value is not None else fallback)
    # Avoid invalid XML control characters in worksheet strings.
    return re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F]", "", text)


def _short_assessment_header(value: object) -> str:
    """Remove category paths and compact an activity title with its max points."""
    heading = _safe_text(value).strip()
    if not heading:
        return ""
    if "·" in heading:
        heading = heading.split("·", 1)[1].strip()
    if "/" in heading:
        heading = heading.rsplit("/", 1)[-1].strip()
    maximum = re.search(r"\s*\(Max\s+([^)]+)\)\s*$", heading, re.IGNORECASE)
    if not maximum:
        return heading
    points = maximum.group(1).strip()
    activity = heading[:maximum.start()].strip()
    # Assessment names such as "Midterm Exam" are conventionally displayed as "Midterm".
    activity = re.sub(r"\s+Exam(?:ination)?s?\s*$", "", activity, flags=re.IGNORECASE).strip()
    return f"{activity} ({points})" if activity else f"({points})"


def _normalize_signature_name(value: object) -> str:
    """Preserve saved profile titles and names; normalize casing only."""
    return re.sub(r"\s+", " ", _safe_text(value).strip()).upper()


def _set_literal(cell, value: object) -> None:
    """Write values without allowing user-entered text to become a formula."""
    if value is None:
        cell.value = None
    elif isinstance(value, bool):
        cell.value = value
    elif isinstance(value, (int, float)):
        cell.value = value
    else:
        cell.value = _safe_text(value)
        cell.data_type = "s"


def _merge_with_border(ws: Worksheet, cell_range: str, border: Border | None = None) -> None:
    """Apply edge borders before merging so openpyxl retains the range outline."""
    if border is not None:
        for row in ws[cell_range]:
            for cell in row:
                cell.border = border
    ws.merge_cells(cell_range)


def _add_logo(ws: Worksheet, logo_png_base64: str) -> None:
    if not logo_png_base64:
        return
    try:
        raw = base64.b64decode(logo_png_base64, validate=True)
        if not raw.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("The logo must be a PNG image.")
        image = ExcelImage(BytesIO(raw))
        # Embed only the circular seal at a fixed 80×80 px size. Offsets
        # center it horizontally and vertically in the merged A1:A4 range.
        image.width = 80
        image.height = 80
        image.anchor = OneCellAnchor(
            _from=AnchorMarker(col=0, colOff=4 * 9525, row=0, rowOff=40 * 9525),
            ext=XDRPositiveSize2D(cx=80 * 9525, cy=80 * 9525),
        )
        ws.add_image(image)
    except Exception as exc:
        raise ValueError("The circular university seal could not be read.") from exc


def build_iso_workbook(payload: dict) -> bytes:
    """Build an editable FCU ISO grading workbook and return its XLSX bytes."""
    if not isinstance(payload, dict):
        raise ValueError("Invalid workbook request.")

    header = payload.get("header")
    headers = payload.get("headers")
    rows = payload.get("rows")
    if not isinstance(header, dict) or not isinstance(headers, list) or not isinstance(rows, list):
        raise ValueError("The workbook header, columns, or student rows are missing.")
    if not headers or len(headers) > 180:
        raise ValueError("The workbook must contain between 1 and 180 columns.")
    if len(rows) > 2000:
        raise ValueError("The workbook exceeds the 2,000-student export limit.")
    if any(not isinstance(row, list) for row in rows):
        raise ValueError("A student row has an invalid format.")

    header_fields = (
        "organizationName", "organizationAddress", "formName", "formNo",
        "effectivity", "issuingOffice", "revisionNo", "eomsTitle",
        "affiliationLine1", "affiliationLine2", "submittedBy", "deanName",
    )
    clean_header = {key: _safe_text(header.get(key, "")) for key in header_fields}
    required_fields = header_fields[:10]
    if any(not clean_header[key].strip() for key in required_fields):
        raise ValueError("Complete all ISO document-control fields before exporting.")

    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = re.sub(r"[\\/*?:\[\]]", " ", _safe_text(payload.get("sheetName", "ISO Grading Sheet")))[:31] or "ISO Grading Sheet"
    worksheet.sheet_view.showGridLines = True
    worksheet.freeze_panes = "A12"
    worksheet.sheet_properties.pageSetUpPr.fitToPage = True
    worksheet.page_setup.orientation = "portrait"
    worksheet.page_setup.paperSize = "14"  # Folio paper code: Long bond, 8.5 x 13 inches.
    worksheet.page_setup.fitToWidth = 1
    worksheet.page_setup.fitToHeight = 0
    worksheet.page_margins.left = 0.25
    worksheet.page_margins.right = 0.25
    worksheet.page_margins.top = 0.35
    worksheet.page_margins.bottom = 0.35
    worksheet.page_margins.header = 0.15
    worksheet.page_margins.footer = 0.15
    worksheet.print_title_rows = "11:11"

    worksheet.sheet_format.defaultRowHeight = 20
    for row_number, height in enumerate((34, 28, 34, 24), start=1):
        worksheet.row_dimensions[row_number].height = height
        for column_number in range(1, 8):
            cell = worksheet.cell(row_number, column_number)
            cell.border = THIN_BORDER
            cell.font = Font(name="Arial", size=9, color="FF000000")
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

        # FCU-EOMS-RO-006-F institutional header. Border all 28 source cells
    # before merging so every visible perimeter remains explicitly outlined.
    _merge_with_border(worksheet, "A1:A4", THIN_BORDER)
    _merge_with_border(worksheet, "B1:E1", THIN_BORDER)
    _merge_with_border(worksheet, "C2:E2", THIN_BORDER)
    _merge_with_border(worksheet, "C3:E3", THIN_BORDER)

    identity = CellRichText(
        TextBlock(InlineFont(rFont="Arial", sz=11, b=True), clean_header["organizationName"] + "\n"),
        TextBlock(InlineFont(rFont="Arial", sz=8.5, i=True), clean_header["organizationAddress"]),
    )
    worksheet["B1"] = identity
    worksheet["B1"].alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

    _set_literal(worksheet["B2"], "Form Name:")
    _set_literal(worksheet["C2"], clean_header["formName"])
    _set_literal(worksheet["B3"], "Form No:\n" + clean_header["formNo"])
    _set_literal(worksheet["C3"], clean_header["eomsTitle"])
    _set_literal(worksheet["B4"], "Revision No. " + clean_header["revisionNo"])

    _set_literal(worksheet["F2"], "Effectivity:")
    _set_literal(worksheet["G2"], clean_header["effectivity"])
    _set_literal(worksheet["F3"], "Issuing Office:")
    _set_literal(worksheet["G3"], clean_header["issuingOffice"])
    _set_literal(worksheet["F4"], "Page No.")
    _set_literal(worksheet["G4"], "1")

    for coordinate in ("B2", "B3", "B4", "F2", "F3", "F4", "G2", "G3", "G4"):
        worksheet[coordinate].font = Font(name="Arial", size=8, bold=True, color="FF000000")
        worksheet[coordinate].alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    worksheet["C2"].font = Font(name="Arial", size=11, bold=True, color="FF000000")
    worksheet["C2"].alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    worksheet["C3"].font = Font(name="Arial", size=8, bold=True, color="FF000000")
    worksheet["C3"].alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    worksheet["A1"].alignment = Alignment(horizontal="center", vertical="center")

    # Accreditation copy is outside the bordered box and deliberately borderless.
    worksheet.merge_cells("A5:G5")
    worksheet.merge_cells("A6:G6")
    _set_literal(worksheet["A5"], clean_header["affiliationLine1"])
    _set_literal(worksheet["A6"], clean_header["affiliationLine2"])
    for coordinate in ("A5", "A6"):
        worksheet[coordinate].border = NO_BORDER
        worksheet[coordinate].font = Font(name="Arial", size=8, color="FF000000")
        worksheet[coordinate].alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    worksheet.row_dimensions[5].height = 17
    worksheet.row_dimensions[6].height = 17
    worksheet.row_dimensions[7].height = 22

    _add_logo(worksheet, _safe_text(payload.get("logoPngBase64", "")))

    column_count = max(7, len(headers), max((len(row) for row in rows), default=0))
    last_column_letter = __import__("openpyxl").utils.get_column_letter(column_count)
    normalized_headers = [_short_assessment_header(value) for value in headers]
    normalized_headers.extend([""] * (column_count - len(normalized_headers)))
    header_fill = PatternFill(fill_type="solid", fgColor="FFEFEFEF")
    table_font = Font(name="Arial", size=8, bold=True, color="FF000000")
    body_font = Font(name="Arial", size=9, color="FF000000")

    # Class metadata is supplied by the authenticated subject route for every export.
    # Accept both the explicit class shape and subject-style field names for compatibility.
    class_metadata = payload.get("class") or payload.get("subject") or {}
    if not isinstance(class_metadata, dict):
        class_metadata = {}
    course_code = _safe_text(class_metadata.get("courseCode", class_metadata.get("code", "")))
    course_title = _safe_text(class_metadata.get("courseTitle", class_metadata.get("title", "")))
    class_id = _safe_text(class_metadata.get("classId", "")).strip()
    if re.match(r"^migration[_-]\d{4}[_-]", class_id, re.IGNORECASE):
        class_id = ""
    semester = _safe_text(class_metadata.get("semester", class_metadata.get("term", "")))
    academic_year = _safe_text(class_metadata.get("academicYear", ""))

        # Rows 7–8 use separate label/value cells; section IDs are human-readable.
    _set_literal(worksheet["A7"], "Course No.")
    _set_literal(worksheet["B7"], course_code)
    _set_literal(worksheet["C7"], "Descriptive Title")
    worksheet.merge_cells("D7:G7")
    _set_literal(worksheet["D7"], course_title)

    _set_literal(worksheet["A8"], "Class I.D.")
    _set_literal(worksheet["B8"], class_id)
    _set_literal(worksheet["C8"], "Semester")
    _set_literal(worksheet["D8"], semester)
    _set_literal(worksheet["E8"], "Academic Year")
    _set_literal(worksheet["F8"], academic_year)
    for column_number in range(1, 8):
        worksheet.cell(8, column_number).border = METADATA_BOTTOM_BORDER
    for coordinate in ("A7", "B7", "C7", "D7", "A8", "B8", "C8", "D8", "E8", "F8"):
        worksheet[coordinate].font = Font(name="Arial", size=9, bold=coordinate[0] in ("A", "C", "E"), color="FF000000")
        worksheet[coordinate].alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
    worksheet.row_dimensions[7].height = 23
    worksheet.row_dimensions[8].height = 25

    # Keep rows 9–10 open as breathing room below the class details.
    worksheet.row_dimensions[9].height = 8
    worksheet.row_dimensions[10].height = 8

    for column_number, value in enumerate(normalized_headers, start=1):
        cell = worksheet.cell(11, column_number)
        _set_literal(cell, value)
        cell.border = THIN_BORDER
        cell.fill = header_fill
        cell.font = table_font
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    worksheet.row_dimensions[11].height = 30

    for row_offset, row_values in enumerate(rows, start=12):
        worksheet.row_dimensions[row_offset].height = 22
        for column_number in range(1, column_count + 1):
            value = row_values[column_number - 1] if column_number <= len(row_values) else ""
            cell = worksheet.cell(row_offset, column_number)
            _set_literal(cell, value)
            cell.border = THIN_BORDER
            cell.font = body_font
            heading = _safe_text(normalized_headers[column_number - 1]).upper()
            horizontal = "left" if column_number == 2 else "center"
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                horizontal = "right"
                if "(%)" in heading or "TOTAL GRADE" in heading:
                    # Percentage columns are passed as fractions (0.2226 = 22.26%).
                    cell.number_format = "0.00%"
            if "FINAL GRADE" in heading:
                horizontal = "center"
            cell.alignment = Alignment(horizontal=horizontal, vertical="center", wrap_text=True)

    # Compact, role-based widths remain predictable for every subject's dynamic columns.
    for index in range(column_count):
        heading = _safe_text(normalized_headers[index]).upper()
        if index == 0:
            width = 12
        elif index == 1:
            width = 32
        elif "TOTAL GRADE" in heading:
            width = 14
        elif "FINAL GRADE" in heading:
            width = 12
        elif "REMARK" in heading:
            width = 12
        elif "(%)" in heading:
            width = 12
        else:
            width = 10
        worksheet.column_dimensions[__import__("openpyxl").utils.get_column_letter(index + 1)].width = width

    # Signature block: merged left/right areas and a thin bottom rule for signing.
    data_end_row = 11 + len(rows)
    signature_label_row = data_end_row + 2
    signature_name_row = data_end_row + 3
    signature_role_row = data_end_row + 4
    left_end = max(1, column_count // 2)
    right_start = left_end + 1
    last_column = __import__("openpyxl").utils.get_column_letter(column_count)
    left_end_letter = __import__("openpyxl").utils.get_column_letter(left_end)
    right_start_letter = __import__("openpyxl").utils.get_column_letter(right_start)

    left_label_range = "A{0}:{1}{0}".format(signature_label_row, left_end_letter)
    right_label_range = "{0}{1}:{2}{1}".format(right_start_letter, signature_label_row, last_column)
    left_name_range = "A{0}:{1}{0}".format(signature_name_row, left_end_letter)
    right_name_range = "{0}{1}:{2}{1}".format(right_start_letter, signature_name_row, last_column)
    left_role_range = "A{0}:{1}{0}".format(signature_role_row, left_end_letter)
    right_role_range = "{0}{1}:{2}{1}".format(right_start_letter, signature_role_row, last_column)

    _merge_with_border(worksheet, left_label_range)
    _merge_with_border(worksheet, right_label_range)
    _merge_with_border(worksheet, left_name_range, BOTTOM_BORDER)
    _merge_with_border(worksheet, right_name_range, BOTTOM_BORDER)
    _merge_with_border(worksheet, left_role_range)
    _merge_with_border(worksheet, right_role_range)

    _set_literal(worksheet.cell(signature_label_row, 1), "Submitted by:")
    _set_literal(worksheet.cell(signature_label_row, right_start), "Noted:")
    teacher_name = _normalize_signature_name(class_metadata.get("teacherName") or clean_header["submittedBy"])
    dean_name = _normalize_signature_name(class_metadata.get("deanName") or clean_header["deanName"])
    _set_literal(worksheet.cell(signature_name_row, 1), teacher_name)
    _set_literal(worksheet.cell(signature_name_row, right_start), dean_name)
    _set_literal(worksheet.cell(signature_role_row, 1), "TEACHER'S SIGNATURE OVER PRINTED NAME")
    _set_literal(worksheet.cell(signature_role_row, right_start), "DEAN'S SIGNATURE OVER PRINTED NAME")

    for row_number in (signature_label_row, signature_name_row, signature_role_row):
        worksheet.row_dimensions[row_number].height = 20
    worksheet.row_dimensions[signature_name_row].height = 27
    for coordinate in (
        worksheet.cell(signature_label_row, 1).coordinate,
        worksheet.cell(signature_label_row, right_start).coordinate,
    ):
        worksheet[coordinate].font = Font(name="Arial", size=9, bold=True)
        worksheet[coordinate].alignment = Alignment(horizontal="left", vertical="center")
    for coordinate in (
        worksheet.cell(signature_name_row, 1).coordinate,
        worksheet.cell(signature_name_row, right_start).coordinate,
    ):
        worksheet[coordinate].font = Font(name="Arial", size=9)
        worksheet[coordinate].alignment = Alignment(horizontal="center", vertical="center")
    for coordinate in (
        worksheet.cell(signature_role_row, 1).coordinate,
        worksheet.cell(signature_role_row, right_start).coordinate,
    ):
        worksheet[coordinate].font = Font(name="Arial", size=8)
        worksheet[coordinate].alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

    worksheet.print_area = "A1:{0}{1}".format(last_column, signature_role_row)
    workbook.properties.title = "FCU-EOMS-RO-006-F Collegiate Grading Sheet"
    workbook.properties.subject = "Educational Organization Management System"
    workbook.properties.creator = clean_header["organizationName"]

    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


class handler(BaseHTTPRequestHandler):
    """Vercel Python Function handler. Only the signed Next.js route can call it."""

    def _json_response(self, status: int, body: dict) -> None:
        raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self) -> None:
        if urlsplit(self.path).path != "/api/iso_export":
            self._json_response(404, {"error": "Not found."})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._json_response(400, {"error": "Invalid request size."})
            return
        if content_length <= 0 or content_length > MAX_REQUEST_BYTES:
            self._json_response(413, {"error": "The workbook request is empty or too large."})
            return

        raw_body = self.rfile.read(content_length)
        secret = os.environ.get("AUTH_SECRET", "")
        timestamp = self.headers.get("X-Saga-Iso-Timestamp", "")
        signature = self.headers.get("X-Saga-Iso-Signature", "")
        if len(secret) < 32 or not timestamp.isdigit() or not re.fullmatch(r"[a-f0-9]{64}", signature):
            self._json_response(401, {"error": "Unauthorized export request."})
            return
        if abs(int(time.time()) - int(timestamp)) > MAX_CLOCK_SKEW_SECONDS:
            self._json_response(401, {"error": "The signed export request has expired."})
            return

        signed_message = SIGNING_CONTEXT + timestamp.encode("ascii") + b"\n" + raw_body
        expected_signature = hmac.new(secret.encode("utf-8"), signed_message, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected_signature):
            self._json_response(401, {"error": "Unauthorized export request."})
            return

        try:
            payload = json.loads(raw_body.decode("utf-8"))
            workbook_bytes = build_iso_workbook(payload)
            filename = re.sub(r"[^A-Za-z0-9._-]", "-", _safe_text(payload.get("filename", "iso-grading-sheet.xlsx")))
            if not filename.lower().endswith(".xlsx"):
                filename += ".xlsx"
            self.send_response(200)
            self.send_header("Content-Type", MIME_TYPE)
            self.send_header("Content-Disposition", 'attachment; filename="' + filename[:160] + '"')
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(workbook_bytes)))
            self.end_headers()
            self.wfile.write(workbook_bytes)
        except (ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
            self._json_response(400, {"error": str(exc) or "Invalid workbook data."})
        except Exception:
            self._json_response(500, {"error": "The Excel workbook could not be generated."})

    def do_GET(self) -> None:
        self._json_response(405, {"error": "Use POST to generate a workbook."})
