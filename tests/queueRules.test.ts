import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  QueueRuleError,
  assertAllowedTransition,
  calculateWait,
  callNextCustomer,
  findActiveSpot,
  issueToken,
  normalizePhone,
  setBarberAvailability,
} from "../server/src/queueRules.js";

function createDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE barbers (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      on_duty INTEGER NOT NULL DEFAULT 1,
      on_break INTEGER NOT NULL DEFAULT 0,
      photo_url TEXT
    );
    CREATE TABLE services (
      id INTEGER PRIMARY KEY,
      name_en TEXT NOT NULL,
      name_gu TEXT NOT NULL,
      minutes INTEGER NOT NULL,
      price INTEGER NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE queue_entries (
      id INTEGER PRIMARY KEY,
      token TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      preferred_barber_id INTEGER,
      assigned_barber_id INTEGER,
      status TEXT NOT NULL,
      is_walk_in INTEGER NOT NULL DEFAULT 0,
      joined_at TEXT NOT NULL,
      called_at TEXT,
      started_at TEXT,
      finished_at TEXT
    );
    CREATE TABLE queue_entry_services (
      queue_entry_id INTEGER NOT NULL,
      service_id INTEGER NOT NULL
    );
    CREATE TABLE salon_settings (
      setting_key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  db.prepare("INSERT INTO barbers (id,name,on_duty,on_break) VALUES (1,'Ravi',1,0)").run();
  db.prepare("INSERT INTO barbers (id,name,on_duty,on_break) VALUES (2,'Amit',1,0)").run();
  db.prepare("INSERT INTO services (id,name_en,name_gu,minutes,price,enabled) VALUES (1,'Haircut','',30,150,1)").run();
  db.prepare("INSERT INTO services (id,name_en,name_gu,minutes,price,enabled) VALUES (2,'Beard','',15,80,1)").run();
  db.prepare("INSERT INTO salon_settings (setting_key,value) VALUES ('is_open','1')").run();
  db.prepare("INSERT INTO salon_settings (setting_key,value) VALUES ('closing_time','21:00')").run();
  return db;
}

test("normalizes phone formatting to exact digits", () => {
  assert.equal(normalizePhone("+91 98765-43210"), "919876543210");
  assert.equal(normalizePhone("9876543210"), "9876543210");
});

test("next-customer respects Ravi preference and Any fallback", () => {
  const db = createDb();
  const insert = db.prepare(`
    INSERT INTO queue_entries
      (id,token,customer_name,phone,preferred_barber_id,assigned_barber_id,status,is_walk_in,joined_at)
    VALUES (?, ?, ?, ?, ?, NULL, 'Waiting', 1, ?)
  `);
  insert.run(1, "S-1", "Ravi customer", "9000000001", 1, "2026-01-01T09:00:00.000Z");
  insert.run(2, "S-2", "Any customer", "9000000002", null, "2026-01-01T09:01:00.000Z");

  const amitCall = callNextCustomer(db, 2);
  assert.equal(amitCall?.token, "S-2");
  assert.equal(amitCall?.preferredBarberId, null);

  const raviCall = callNextCustomer(db, 1);
  assert.equal(raviCall?.token, "S-1");
  assert.equal(raviCall?.preferredBarberName, "Ravi");
  db.close();
});

test("wait is divided among on-duty non-break barbers", () => {
  const db = createDb();
  setBarberAvailability(db, 1, false);
  setBarberAvailability(db, 2, true);
  assert.equal(calculateWait(db, 30, null), 30);
  db.close();
});

test("forwards-only transitions reject skipped and backwards moves", () => {
  assert.doesNotThrow(() => assertAllowedTransition("Waiting", "Called", ["Called"]));
  assert.doesNotThrow(() => assertAllowedTransition("Called", "In chair", ["In chair"]));
  assert.throws(
    () => assertAllowedTransition("Waiting", "In chair", ["In chair"]),
    QueueRuleError,
  );
  assert.throws(
    () => assertAllowedTransition("Done", "Waiting", ["Waiting"]),
    QueueRuleError,
  );
});

test("tokens reset once for an old Asia/Kolkata date", () => {
  const db = createDb();
  db.prepare("INSERT INTO salon_settings (setting_key,value) VALUES ('token_date','2000-01-01')").run();
  db.prepare("INSERT INTO salon_settings (setting_key,value) VALUES ('token_sequence','99')").run();
  const token = issueToken(db);
  assert.equal(token, "S-1");
  assert.equal(issueToken(db), "S-2");
  db.close();
});

test("duplicate active phone lookup is normalized and active-only", () => {
  const db = createDb();
  db.prepare(`
    INSERT INTO queue_entries
      (id,token,customer_name,phone,preferred_barber_id,status,is_walk_in,joined_at)
    VALUES (1,'S-1','A','9876543210',NULL,'Waiting',0,'2026-01-01T09:00:00.000Z')
  `).run();
  assert.equal(findActiveSpot(db, "9876543210")?.id, 1);
  db.prepare("UPDATE queue_entries SET status='Cancelled' WHERE id=1").run();
  assert.equal(findActiveSpot(db, "9876543210"), undefined);
  db.close();
});
