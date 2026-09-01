"""Generate the blank operational forms published by the Cutting Tracker.

These are intentionally neutral internal templates. Official HR, safety, or
regulatory forms can replace the generated PDFs without changing the app.
"""

from pathlib import Path
import shutil

from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import letter, landscape
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf"
WEB = ROOT / "assets" / "forms"
LOGO = ROOT / "assets" / "bv-logo.png"

NAVY = HexColor("#0F2A4A")
BLUE = HexColor("#176B9C")
CYAN = HexColor("#0EA5E9")
SLATE = HexColor("#475569")
MUTED = HexColor("#64748B")
LINE = HexColor("#CBD5E1")
PALE = HexColor("#F1F5F9")
ALERT = HexColor("#B91C1C")
AMBER = HexColor("#B45309")


def text(c, x, y, value, size=8, color=NAVY, font="Helvetica"):
    c.setFont(font, size)
    c.setFillColor(color)
    c.drawString(x, y, value)


def right_text(c, x, y, value, size=8, color=NAVY, font="Helvetica"):
    c.setFont(font, size)
    c.setFillColor(color)
    c.drawRightString(x, y, value)


def header(c, title, subtitle, page_width, page_height, code, page=None):
    c.setFillColor(NAVY)
    c.rect(0, page_height - 66, page_width, 66, fill=1, stroke=0)
    # The exact three-shape mark used by the app, reversed for the dark header.
    x, y, s = 24, page_height - 52, 0.75
    c.setFillColor(HexColor("#35BCE1"))
    c.rect(x, y + 17 * s, 18 * s, 15 * s, fill=1, stroke=0)
    c.setFillColor(HexColor("#1E71AB"))
    c.rect(x, y, 18 * s, 15 * s, fill=1, stroke=0)
    c.setFillColor(HexColor("#72B843"))
    c.setStrokeColor(HexColor("#72B843"))
    p = c.beginPath()
    p.moveTo(x + 19 * s, y + 32 * s)
    p.lineTo(x + 31.5 * s, y + 32 * s)
    p.lineTo(x + 25.2 * s, y + 17 * s)
    p.lineTo(x + 19 * s, y + 17 * s)
    p.close()
    c.drawPath(p, fill=1, stroke=0)
    p = c.beginPath()
    p.moveTo(x + 19 * s, y + 15 * s)
    p.lineTo(x + 24.4 * s, y + 15 * s)
    p.lineTo(x + 19 * s, y + 2 * s)
    p.close()
    c.drawPath(p, fill=1, stroke=0)
    text(c, 52, page_height - 34, "BV GLAZING", 7.5, white, "Helvetica-Bold")
    text(c, 52, page_height - 45, "SYSTEMS", 5.5, HexColor("#DCEAF4"), "Helvetica-Bold")
    text(c, 138, page_height - 31, title, 16, white, "Helvetica-Bold")
    text(c, 138, page_height - 48, subtitle, 8, HexColor("#DCEAF4"))
    right_text(c, page_width - 24, page_height - 27, code, 8, white, "Helvetica-Bold")
    if page:
        right_text(c, page_width - 24, page_height - 44, page, 7, HexColor("#DCEAF4"))


def footer(c, page_width, note="Internal blank template - replace with the approved controlled form when issued."):
    c.setStrokeColor(LINE)
    c.line(24, 28, page_width - 24, 28)
    text(c, 24, 16, note, 6.5, MUTED)
    right_text(c, page_width - 24, 16, "BV Glazing Systems - Cutting Department", 6.5, MUTED, "Helvetica-Bold")


def section(c, x, y, width, label, tone=BLUE):
    c.setFillColor(tone)
    c.roundRect(x, y - 15, width, 17, 3, fill=1, stroke=0)
    text(c, x + 8, y - 10, label.upper(), 8, white, "Helvetica-Bold")


def label(c, x, y, value):
    text(c, x, y, value.upper(), 6.5, SLATE, "Helvetica-Bold")


def field(c, name, x, y, width, height=18, value="", multiline=False, font_size=8):
    flags = "multiline" if multiline else ""
    c.acroForm.textfield(
        name=name, value=value, x=x, y=y, width=width, height=height,
        borderWidth=0.8, borderColor=LINE, fillColor=white, textColor=NAVY,
        forceBorder=True, fontName="Helvetica", fontSize=font_size,
        fieldFlags=flags,
    )


def labeled_field(c, name, x, y, width, title, height=18, multiline=False):
    label(c, x, y + height + 4, title)
    field(c, name, x, y, width, height, multiline=multiline)


def checkbox(c, name, x, y, title, checked=False, size=10):
    c.acroForm.checkbox(
        name=name, x=x, y=y, size=size, checked=checked,
        borderWidth=0.8, borderColor=MUTED, fillColor=white,
        buttonStyle="check", forceBorder=True,
    )
    text(c, x + size + 4, y + 1, title, 7.5, NAVY)


def production_form(path):
    page_width, page_height = landscape(letter)
    c = canvas.Canvas(str(path), pagesize=(page_width, page_height))
    c.setTitle("BV Production Activity Record")
    header(c, "Production Activity Record", "Blank shift record for machine and cell activity",
           page_width, page_height, "OPS-PROD-TEMPLATE")

    top = page_height - 93
    labeled_field(c, "production_date", 24, top - 18, 88, "Date")
    labeled_field(c, "production_shift", 122, top - 18, 86, "Shift")
    labeled_field(c, "production_machine", 218, top - 18, 150, "Machine / work cell")
    labeled_field(c, "production_lead", 378, top - 18, 150, "Shift lead")
    labeled_field(c, "production_operators", 538, top - 18, 230, "Operators")

    table_top = top - 58
    section(c, 24, table_top + 22, page_width - 48, "Production lines completed or in progress")
    columns = [
        ("Time", 54), ("Work order", 86), ("Die / profile", 92), ("Qty", 50),
        ("Length", 65), ("Status", 78), ("Operator", 94), ("Notes / issue", 198),
    ]
    x = 24
    header_y = table_top - 2
    c.setFillColor(PALE)
    c.rect(24, header_y - 18, page_width - 48, 18, fill=1, stroke=0)
    for title, width in columns:
        text(c, x + 4, header_y - 12, title.upper(), 6.5, SLATE, "Helvetica-Bold")
        x += width

    row_h = 24
    for row in range(12):
        y = header_y - 18 - (row + 1) * row_h
        x = 24
        for col, (_, width) in enumerate(columns):
            field(c, f"production_r{row + 1}_c{col + 1}", x, y, width, row_h, font_size=7)
            x += width

    summary_y = 86
    section(c, 24, summary_y + 61, page_width - 48, "Shift closeout")
    labeled_field(c, "production_carryover", 24, summary_y, 286, "Carry-over / next action", 32, True)
    labeled_field(c, "production_shortages", 320, summary_y, 214, "Shortages / back orders", 32, True)
    labeled_field(c, "production_safety", 544, summary_y, 224, "Safety / quality notes", 32, True)
    labeled_field(c, "production_completed_by", 24, 46, 220, "Completed by")
    labeled_field(c, "production_completed_time", 254, 46, 95, "Time")
    labeled_field(c, "production_supervisor_review", 359, 46, 260, "Supervisor review")
    labeled_field(c, "production_review_time", 629, 46, 139, "Review time")
    footer(c, page_width)
    c.save()


def incident_form(path):
    page_width, page_height = letter
    c = canvas.Canvas(str(path), pagesize=letter)
    c.setTitle("BV Incident Reporting Form")
    header(c, "Incident Reporting Form", "Record facts promptly and notify the required supervisor",
           page_width, page_height, "HS-INC-TEMPLATE", "Page 1 of 2")

    c.setFillColor(HexColor("#FEF2F2"))
    c.setStrokeColor(HexColor("#FCA5A5"))
    c.roundRect(24, page_height - 108, page_width - 48, 28, 4, fill=1, stroke=1)
    text(c, 34, page_height - 96,
         "EMERGENCY: Get medical help, secure the area, and follow the approved BV emergency procedure first.",
         7.5, ALERT, "Helvetica-Bold")

    y = page_height - 136
    section(c, 24, y, page_width - 48, "Report information")
    labeled_field(c, "incident_reported_by", 24, y - 43, 185, "Reported by")
    labeled_field(c, "incident_job_title", 219, y - 43, 150, "Job title / department")
    labeled_field(c, "incident_supervisor", 379, y - 43, 189, "Supervisor notified")
    labeled_field(c, "incident_date", 24, y - 82, 110, "Incident date")
    labeled_field(c, "incident_time", 144, y - 82, 90, "Incident time")
    labeled_field(c, "incident_location", 244, y - 82, 324, "Exact location")

    y -= 118
    section(c, 24, y, page_width - 48, "Incident type")
    checkbox(c, "incident_type_injury", 30, y - 36, "Injury / illness")
    checkbox(c, "incident_type_nearmiss", 145, y - 36, "Near miss")
    checkbox(c, "incident_type_property", 240, y - 36, "Property damage")
    checkbox(c, "incident_type_quality", 370, y - 36, "Quality event")
    checkbox(c, "incident_type_other", 474, y - 36, "Other")
    labeled_field(c, "incident_person_affected", 24, y - 76, 260, "Person affected (if any)")
    labeled_field(c, "incident_witnesses", 294, y - 76, 274, "Witness name(s)")

    y -= 112
    section(c, 24, y, page_width - 48, "What happened")
    labeled_field(c, "incident_description", 24, y - 112, page_width - 48,
                  "Describe the sequence of events and observed conditions - facts only", 86, True)

    y -= 150
    section(c, 24, y, page_width - 48, "Immediate response")
    labeled_field(c, "incident_immediate_action", 24, y - 86, page_width - 48,
                  "First aid, area control, equipment shutdown, notifications, or other immediate actions", 60, True)
    checkbox(c, "incident_first_aid", 30, y - 110, "First aid provided")
    checkbox(c, "incident_medical", 155, y - 110, "Medical attention")
    checkbox(c, "incident_area_secured", 290, y - 110, "Area secured")
    checkbox(c, "incident_equipment_isolated", 400, y - 110, "Equipment isolated")
    footer(c, page_width,
           "Internal reporting template - follow approved BV safety, HR, privacy, and regulatory procedures.")
    c.showPage()

    header(c, "Incident Reporting Form", "Follow-up, review, and corrective action",
           page_width, page_height, "HS-INC-TEMPLATE", "Page 2 of 2")
    y = page_height - 96
    section(c, 24, y, page_width - 48, "Equipment, task, and conditions")
    labeled_field(c, "incident_task", 24, y - 44, 260, "Task being performed")
    labeled_field(c, "incident_equipment", 294, y - 44, 274, "Machine / equipment / material")
    labeled_field(c, "incident_ppe", 24, y - 88, 260, "PPE in use")
    labeled_field(c, "incident_conditions", 294, y - 88, 274, "Environmental conditions")

    y -= 124
    section(c, 24, y, page_width - 48, "Supervisor review")
    labeled_field(c, "incident_contributing_factors", 24, y - 102, page_width - 48,
                  "Known or suspected contributing factors - do not assign blame", 76, True)
    labeled_field(c, "incident_corrective_actions", 24, y - 206, page_width - 48,
                  "Corrective actions, owner, and due date", 78, True)
    labeled_field(c, "incident_followup", 24, y - 294, page_width - 48,
                  "Follow-up verification and notes", 62, True)

    y -= 326
    section(c, 24, y, page_width - 48, "Sign-off and routing")
    labeled_field(c, "incident_employee_signature", 24, y - 43, 260, "Employee / reporter")
    labeled_field(c, "incident_employee_date", 294, y - 43, 110, "Date")
    labeled_field(c, "incident_supervisor_signature", 24, y - 82, 260, "Supervisor")
    labeled_field(c, "incident_supervisor_date", 294, y - 82, 110, "Date")
    checkbox(c, "incident_route_safety", 420, y - 42, "Safety")
    checkbox(c, "incident_route_hr", 490, y - 42, "HR")
    checkbox(c, "incident_route_management", 420, y - 70, "Management")
    footer(c, page_width,
           "Internal reporting template - protect personal information and use the approved controlled process.")
    c.save()


def orientation_form(path):
    page_width, page_height = letter
    c = canvas.Canvas(str(path), pagesize=letter)
    c.setTitle("BV Worker Orientation Checklist")
    header(c, "Worker Orientation Checklist", "Document site, department, and task orientation",
           page_width, page_height, "HR-SAF-ORI-TEMPLATE", "Page 1 of 2")

    y = page_height - 96
    section(c, 24, y, page_width - 48, "Worker and assignment")
    labeled_field(c, "orientation_worker", 24, y - 43, 240, "Worker name")
    labeled_field(c, "orientation_employee_id", 274, y - 43, 120, "Employee ID")
    labeled_field(c, "orientation_start_date", 404, y - 43, 164, "Start / transfer date")
    labeled_field(c, "orientation_role", 24, y - 82, 240, "Role / position")
    labeled_field(c, "orientation_department", 274, y - 82, 140, "Department")
    labeled_field(c, "orientation_supervisor", 424, y - 82, 144, "Supervisor")
    labeled_field(c, "orientation_trainer", 24, y - 121, 240, "Orientation completed by")
    labeled_field(c, "orientation_language", 274, y - 121, 294, "Language / accommodation needs")

    y -= 158
    section(c, 24, y, page_width - 48, "Site and safety orientation")
    topics = [
        "Site access, parking, sign-in, and restricted areas",
        "Emergency alarms, exits, muster point, and evacuation",
        "First aid stations and how to obtain medical assistance",
        "Required PPE and replacement process",
        "Hazard reporting, near misses, and incident reporting",
        "WHMIS / chemical labels and Safety Data Sheets",
        "Machine guarding and authorization boundaries",
        "Lockout / tagout awareness - authorized work only",
        "Pedestrian routes, forklifts, cranes, and suspended loads",
        "Housekeeping, sharp edges, glass, and material handling",
        "Break times, attendance, and shift communication",
        "Respectful workplace, harassment, and escalation contacts",
    ]
    start_y = y - 34
    for i, topic in enumerate(topics):
        row_y = start_y - i * 27
        c.setFillColor(PALE if i % 2 == 0 else white)
        c.rect(24, row_y - 6, page_width - 48, 24, fill=1, stroke=0)
        checkbox(c, f"orientation_topic_{i + 1}", 31, row_y, topic, size=10)
        field(c, f"orientation_initial_{i + 1}", page_width - 72, row_y - 2, 40, 15, font_size=7)
    label(c, page_width - 72, start_y + 24, "Initial")

    labeled_field(c, "orientation_site_notes", 24, 68, page_width - 48,
                  "Site orientation notes / follow-up required", 42, True)
    footer(c, page_width)
    c.showPage()

    header(c, "Worker Orientation Checklist", "Department and task-specific confirmation",
           page_width, page_height, "HR-SAF-ORI-TEMPLATE", "Page 2 of 2")
    y = page_height - 96
    section(c, 24, y, page_width - 48, "Department and job-specific training")
    rows = [
        "Work area tour and department contacts",
        "Job description, expected quality, and stop-work authority",
        "Applicable SOPs, work instructions, and drawings",
        "Machine-specific hazards and safe operating limits",
        "Pre-use inspection and defect reporting",
        "Material identification, staging, and safe lifting methods",
        "Production tracker login, status updates, and shift handoff",
        "Back-order, shortage, rush, and routing escalation",
        "Waste, scrap, quality hold, and non-conformance process",
        "Demonstrated task under supervision",
    ]
    table_y = y - 28
    c.setFillColor(PALE)
    c.rect(24, table_y - 4, page_width - 48, 20, fill=1, stroke=0)
    text(c, 32, table_y + 2, "TOPIC", 6.5, SLATE, "Helvetica-Bold")
    text(c, 396, table_y + 2, "TRAINER / DATE", 6.5, SLATE, "Helvetica-Bold")
    text(c, 506, table_y + 2, "COMPLETE", 6.5, SLATE, "Helvetica-Bold")
    for i, topic in enumerate(rows):
        row_y = table_y - 40 - i * 34
        c.setStrokeColor(LINE)
        c.rect(24, row_y, page_width - 48, 34, fill=0, stroke=1)
        text(c, 32, row_y + 12, topic, 7.5, NAVY)
        field(c, f"orientation_trainer_date_{i + 1}", 390, row_y + 6, 108, 22, font_size=7)
        checkbox(c, f"orientation_task_complete_{i + 1}", 525, row_y + 11, "", size=10)

    section(c, 24, 304, page_width - 48, "Restrictions and follow-up")
    labeled_field(c, "orientation_restrictions", 24, 214, page_width - 48,
                  "Restrictions, incomplete training, required supervision, or accommodation", 66, True)
    labeled_field(c, "orientation_followup_date", 24, 174, 160, "Follow-up date")
    labeled_field(c, "orientation_followup_owner", 194, 174, 240, "Follow-up owner")

    section(c, 24, 146, page_width - 48, "Acknowledgement")
    text(c, 24, 118,
         "Signatures confirm that the orientation was reviewed and questions could be asked. They do not replace",
         7.2, NAVY)
    text(c, 24, 106, "competency assessment, machine authorization, or any required certified training.", 7.2, NAVY)
    labeled_field(c, "orientation_worker_signature", 24, 68, 245, "Worker signature")
    labeled_field(c, "orientation_worker_sign_date", 279, 68, 110, "Date")
    labeled_field(c, "orientation_supervisor_signature", 24, 34, 245, "Supervisor / trainer signature")
    labeled_field(c, "orientation_supervisor_sign_date", 279, 34, 110, "Date")
    footer(c, page_width,
           "Internal orientation template - use approved policies, SOPs, training records, and authorization controls.")
    c.save()


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    WEB.mkdir(parents=True, exist_ok=True)
    files = {
        "bv-production-activity-record.pdf": production_form,
        "bv-incident-report-form.pdf": incident_form,
        "bv-worker-orientation-checklist.pdf": orientation_form,
    }
    for filename, builder in files.items():
        target = OUTPUT / filename
        builder(target)
        shutil.copy2(target, WEB / filename)
        print(f"Generated {target.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
