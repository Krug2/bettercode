import type { Db } from "./db";

export interface CommandReceipt {
  command_id: string;
  status: string;
  result_json: string | null;
  request_hash: string | null;
  created_at: string;
}

/** Port of rust-backend/src/persistence/command_receipts.rs. */
export class CommandReceiptStore {
  private readonly insertStmt;
  private readonly findStmt;
  private readonly completeStmt;

  constructor(db: Db) {
    this.insertStmt = db.prepare(`
      INSERT INTO command_receipts
        (command_id, status, result_json, request_hash, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    this.findStmt = db.prepare(`
      SELECT command_id, status, result_json, request_hash, created_at
      FROM command_receipts WHERE command_id = ?
    `);
    this.completeStmt = db.prepare(`
      UPDATE command_receipts
      SET status = 'completed', result_json = ?
      WHERE command_id = ?
        AND request_hash = ?
        AND status = 'prepared'
    `);
  }

  insert(r: CommandReceipt): void {
    this.insertStmt.run(
      r.command_id,
      r.status,
      r.result_json,
      r.request_hash,
      r.created_at,
    );
  }

  find(commandId: string): CommandReceipt | null {
    return (this.findStmt.get(commandId) as CommandReceipt | undefined) ?? null;
  }

  complete(input: {
    commandId: string;
    requestHash: string;
    resultJson: string;
  }): boolean {
    return (
      this.completeStmt.run(
        input.resultJson,
        input.commandId,
        input.requestHash,
      ).changes === 1
    );
  }
}
