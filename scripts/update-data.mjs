import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const FDA_EXPORT_URL =
  "https://www.accessdata.fda.gov/scripts/searchtobacco/index.cfm?action=export.viewFile";
const DATA_DIR = new URL("../data/", import.meta.url);
const CURRENT_FILE = new URL("current.json", DATA_DIR);
const CHANGES_FILE = new URL("changes.json", DATA_DIR);
const CSV_FILE = new URL("fda-tobacco-products.csv", DATA_DIR);
const execFileAsync = promisify(execFile);

const EXPORT_BODY = new URLSearchParams({
  STATUS: "",
  CATEGORY: "",
  SUBCATEGORY: "",
  TOBACCO_PRODUCT_NAME: "",
  SUBMISSION: "",
  DATE_ACTION_FROM: "",
  DATE_ACTION_TO: ""
});

const fieldMap = {
  "Company": "company",
  "Product Name": "productName",
  "Category": "category",
  "Sub-Category": "subCategory",
  "Submission Type - Marketing Authority": "submissionType",
  "Date of Action": "actionDate",
  "Order Letter": "orderLetter",
  "Decision Summary": "decisionSummary",
  "Environmental Assessment": "environmentalAssessment",
  "FONSI": "fonsi",
  "STN": "stn",
  "Associated MRTP": "associatedMrtp",
  "Additional Information": "additionalInformation"
};

async function main() {
  await mkdir(DATA_DIR, { recursive: true });

  const previous = await readJsonIfExists(CURRENT_FILE);
  const csvText = await downloadCsv();
  const { asOf, rows } = parseExport(csvText);
  const records = rows.map(normalizeRecord).filter(Boolean);
  const previousIds = new Set((previous?.records ?? []).map((record) => record.id));
  const newRecords = previous ? records.filter((record) => !previousIds.has(record.id)) : [];
  const generatedAt = new Date().toISOString();

  const current = {
    source: FDA_EXPORT_URL,
    sourcePage: "https://www.accessdata.fda.gov/scripts/searchtobacco/",
    asOf,
    generatedAt,
    totalRecords: records.length,
    records
  };

  const changes = {
    source: FDA_EXPORT_URL,
    sourcePage: current.sourcePage,
    asOf,
    generatedAt,
    firstRun: !previous,
    previousAsOf: previous?.asOf ?? null,
    previousTotalRecords: previous?.totalRecords ?? 0,
    currentTotalRecords: records.length,
    newRecordCount: newRecords.length,
    newRecords
  };

  await writeFile(CSV_FILE, csvText, "utf8");
  await writeJson(CURRENT_FILE, current);
  await writeJson(CHANGES_FILE, changes);

  console.log(
    `Wrote ${records.length.toLocaleString()} FDA tobacco product records (${newRecords.length.toLocaleString()} new).`
  );
}

async function downloadCsv() {
  const { stdout } = await execFileAsync(
    "curl",
    [
      "--fail",
      "--silent",
      "--show-error",
      "--location",
      "--max-time",
      "60",
      "--user-agent",
      "Mozilla/5.0",
      "--referer",
      "https://www.accessdata.fda.gov/scripts/searchtobacco/",
      "--header",
      "content-type: application/x-www-form-urlencoded;charset=UTF-8",
      "--data",
      EXPORT_BODY.toString(),
      FDA_EXPORT_URL
    ],
    {
      encoding: "latin1",
      maxBuffer: 25 * 1024 * 1024
    }
  );

  const text = stdout;

  if (!text.includes("\"Company\",\"Product Name\"")) {
    throw new Error("FDA response did not look like the tobacco product CSV export.");
  }

  return text.replace(/\r\n/g, "\n");
}

function parseExport(text) {
  const lines = text.split("\n");
  const asOfMatch = lines[0]?.match(/data as of\s+(.+)$/i);
  const csvStart = lines.findIndex((line) => line.startsWith("\"Company\""));
  if (csvStart === -1) {
    throw new Error("Could not find CSV header row in FDA export.");
  }

  const rows = parseCsv(lines.slice(csvStart).join("\n"));
  const headers = rows.shift();
  const objects = rows
    .filter((row) => row.some((value) => value.trim() !== ""))
    .map((row) =>
      Object.fromEntries(headers.map((header, index) => [header.trim(), row[index]?.trim() ?? ""]))
    );

  return {
    asOf: asOfMatch?.[1]?.trim() ?? null,
    rows: objects
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === "\"" && next === "\"") {
        value += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  return rows;
}

function normalizeRecord(row) {
  const record = {};
  for (const [sourceKey, targetKey] of Object.entries(fieldMap)) {
    record[targetKey] = cleanCell(row[sourceKey] ?? "");
  }

  if (!record.company && !record.productName && !record.stn) {
    return null;
  }

  record.actionDateIso = toIsoDate(record.actionDate);
  record.id = createHash("sha256")
    .update(
      [
        record.company,
        record.productName,
        record.category,
        record.subCategory,
        record.submissionType,
        record.actionDate,
        record.stn
      ].join("|")
    )
    .digest("hex")
    .slice(0, 16);

  return record;
}

function cleanCell(value) {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toIsoDate(value) {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return "";
  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

async function readJsonIfExists(fileUrl) {
  if (!existsSync(fileUrl)) return null;
  return JSON.parse(await readFile(fileUrl, "utf8"));
}

async function writeJson(fileUrl, value) {
  await writeFile(fileUrl, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
