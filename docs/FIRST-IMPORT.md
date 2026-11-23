# First approved Excel import

Do this **only after** the hosting environment and data-handling process have been approved.
Until then, practise with `samples/SYNTHETIC-IA-Weekly-Meeting-Action-points.xlsx`.

## Before you start

1. Make a backup of the empty production database (`scripts/backup.sh`).
2. Keep an untouched copy of `IA Weekly Meeting-Action points (2)-project.xlsx` in the approved document store.
3. If the workbook is macro-enabled (`.xlsm`) or password-protected, save a normal `.xlsx` copy without protection. Do not change any values.
4. Sign in as an **Admin**.

## Step 1 – Main tracker (sheet `IA-MOM`)

1. Go to **Administration → Import Data → Main tracker**, choose the workbook and click **Upload & preview**.
2. Check the header line: worksheet **IA-MOM**, header row **2**, plus the detected title.
3. Open **Column mapping** and confirm the ten columns SN … Feedback. Adjust them if needed and click **Apply mapping**.
4. Check the figures:
   - **Status values recognised** should show **In Progress 23**. Complete, Completed and Closed rows are recognised; legacy "Complete" and "Completed" both become *Completed*, and the original text is kept.
   - *Header repeats* / *title repeats* are copied header rows that will **not** be imported.
   - *Text dates* are values like "Ongoing" or "TBD". They are kept as text and never treated as overdue.
   - *Blank stages* are valid.
5. Use the filters **Warnings & errors** and **Possible duplicates** to check rows. Choose **Import** or **Skip** for each.
6. Click **Confirm import**. The summary appears and the import is recorded in the audit log.

Retrying is safe. Every row is keyed by file hash + sheet + row, so uploading the same workbook again
shows *already imported* and creates nothing.

## Step 2 – Historical tracker (sheet `IA-MOM (2)`)

1. **Import Data → Historical tracker**, upload the same workbook and confirm. Rows are stored as-is for review. Nothing is merged.
2. Go to **Administration → Historical Records**. For each row choose:
   - **Merge** to attach it to the history timeline of the suggested existing action point,
   - **Retain separately** to create its own action point (status normalised, original kept), or
   - **Skip** to keep the raw row for reference only.

## Step 3 – Audit stage template (sheet `Sheet1`)

**Import Data → Audit stage template.** Check the three parts and 14 steps, give the template a name and
confirm. Edit it afterwards under **Audit Reviews & Stages → Audit stage templates**.

## Step 4 – After the import

1. Classify activity types: on the Dashboard, click **Show unclassified items**, then use **Edit** on each item. Types are never guessed from the title.
2. Optionally create projects for audit engagements and link action points to them.
3. Compare the Dashboard counts with the Excel filter (Status = In Progress → 23).
4. Export **Excel Reports → Full Tracker** and compare it with the original workbook.
5. From now on, the website is the system of record. Do not maintain the Excel file.
