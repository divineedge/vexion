import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import nodemailer from "nodemailer";
import { createRequire } from "node:module";
import { z } from "zod";
import { UpdateCustomerBody } from "@workspace/api-zod";

const require = createRequire(import.meta.url);

describe("security dependency upgrade compatibility", () => {
  it("preserves sparse customer patches after the validator upgrade", () => {
    const patch = UpdateCustomerBody.parse({ name: "Fixture" });
    expect(patch).toEqual({ name: "Fixture" });
    expect(UpdateCustomerBody.parse({})).toEqual({});
  });

  it("supports string-keyed custom answers and rejects an oversized bounded array", () => {
    expect(z.record(z.string(), z.unknown()).parse({ fixture: ["value"] }))
      .toEqual({ fixture: ["value"] });
    expect(z.array(z.string()).max(100).safeParse(Array(101).fill("fixture")).success)
      .toBe(false);
  });

  it("generates and reopens an Excel workbook entirely in memory", async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("Security fixture");
    sheet.addRow(["Fixture", 25]);
    const bytes = await book.xlsx.writeBuffer();
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(bytes);
    expect(reopened.worksheets[0].getCell("A1").value).toBe("Fixture");
    expect(reopened.worksheets[0].getCell("B1").value).toBe(25);
  });

  it("retains the UUID v4 entry used by Google storage clients and ExcelJS", () => {
    for (const parent of ["exceljs", "gaxios", "teeny-request"]) {
      const resolutionBase = parent === "exceljs"
        ? require
        : createRequire(require.resolve("@google-cloud/storage"));
      const parentRequire = createRequire(resolutionBase.resolve(parent));
      const { v4 } = parentRequire("uuid");
      expect(v4()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it("formats a message with the updated mailer without sending email", async () => {
    const mailer = nodemailer.createTransport({ jsonTransport: true });
    const info = await mailer.sendMail({
      from: "office@example.invalid", to: "customer@example.invalid",
      subject: "Offline security fixture", text: "No network delivery.",
    });
    const message = JSON.parse(String(info.message));
    expect(message.subject).toBe("Offline security fixture");
    expect(message.to[0].address).toBe("customer@example.invalid");
  });
});
