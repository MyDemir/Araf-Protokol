# PII Encryption HKDF Migration Runbook

> Scope: encrypted PII payloads produced by `backend/scripts/services/encryption.js`.
>
> This is a **migration/runbook requirement**. The code now uses Node.js native `crypto.hkdf()`, but existing encrypted records are not automatically re-encrypted. Do not run a destructive migration unless format detection, tests, backups, and rollback have been prepared.

## 1) What changed

`ArafEncryption` derives a per-wallet data encryption key (DEK) from the configured master key and the normalized wallet address. The current implementation uses Node.js native `crypto.hkdf("sha256", masterKey, salt, info, 32)` with:

- salt: `sha256("araf-pii-salt-v1:<normalized-wallet>")`
- info: `"araf-pii-dek-v1"`
- output: 32-byte AES-256-GCM key

The previous implementation used two chained HMAC operations instead of RFC 5869-compatible HKDF. AES-GCM payload framing stayed the same (`iv` + `authTag` + `ciphertext` as hex), so old and new payloads can look identical at the storage-format level.

## 2) Stored fields that may be affected

Any field encrypted with `encryptField(...)` before the HKDF change may require migration:

| Collection / document | Field | Notes |
|---|---|---|
| `users` | `payout_profile.payout_details_enc` | Encrypted JSON payout details for the wallet owner. |
| `users` | `payout_profile.contact.value_enc` | Optional encrypted Telegram/email/phone contact value. |
| `trades` | `payout_snapshot.maker.payout_details_enc` | Encrypted payout snapshot copied at lock time. |
| `trades` | `payout_snapshot.maker.contact_value_enc` | Optional encrypted maker contact snapshot. |
| `trades` | `payout_snapshot.taker.payout_details_enc` | Encrypted payout snapshot copied at lock time. |
| `trades` | `payout_snapshot.taker.contact_value_enc` | Optional encrypted taker contact snapshot. |
| `trades` | `evidence.receipt_encrypted` | Encrypted receipt/base64 payload. Cleared by retention after completion. |

Non-encrypted metadata such as `rail`, `country`, fingerprint hashes, profile version, timestamps, and bank-change counters is not re-encrypted by this migration.

## 3) Safe old-payload detection

There is no reliable byte-level version marker in the current ciphertext format. A hex string with valid length can be either old or new because both use AES-256-GCM framing.

Use a read-only diagnostic approach first:

1. Work from a database snapshot or staging clone, never directly on production.
2. Select only record ids, owner wallet addresses, field paths, ciphertext length, and timestamps.
3. Attempt decrypt with the **current HKDF derivation** using the expected owner wallet.
4. Treat authentication failure as `current_hkdf_failed`, not as proof of corruption.
5. If an old derivation diagnostic exists, run it only in staging and report aggregate counts such as:
   - `current_hkdf_ok`
   - `legacy_derivation_ok`
   - `both_failed`
   - `missing_or_empty`
6. Never log plaintext, decrypted JSON, receipt contents, raw ciphertext, master keys, DEKs, or KMS responses.

Because there is no embedded `kdf_version`, the safest production marker should be added only after successful re-encryption, for example an internal migration ledger keyed by collection/id/field or a future schema field such as `encryption.kdf_version`. Do not infer migration state from ciphertext shape alone.

## 4) Staging migration procedure

1. **Freeze assumptions**
   - Confirm the exact commit that introduced native `crypto.hkdf()`.
   - Confirm the active `KMS_PROVIDER` and master-key material source used for the staging clone.
   - Confirm wallet-address ownership rules for every affected field.

2. **Backup and clone**
   - Take a production backup/snapshot.
   - Restore into staging with production-like KMS access controls.
   - Disable outbound user notifications and any job that could mutate PII while testing.

3. **Run read-only inventory**
   - Count affected fields by collection and field path.
   - Count empty/null fields separately.
   - Count current-HKDF decrypt successes/failures without printing plaintext.

4. **Build a tested migration tool before any write**
   - The first version must be read-only diagnostic.
   - Write mode must require an explicit environment guard, dry-run output, and a backup id.
   - Unit tests must cover current payloads, legacy payloads, malformed hex, wrong-wallet decrypt, missing fields, and idempotency.

5. **Re-encrypt in staging**
   - For records that decrypt with the legacy derivation, decrypt in memory and immediately re-encrypt with current `encryptField(...)`.
   - Zero or discard plaintext buffers/strings as soon as possible.
   - Write only the new ciphertext plus migration metadata/ledger entry.
   - Do not log plaintext or raw ciphertext.

6. **Verify staging**
   - Current code decrypts all migrated fields.
   - Legacy-only diagnostic count drops to zero for migrated scope.
   - PII reveal endpoints work with authorized trade-scoped tokens.
   - Receipt access/retention behavior remains unchanged.
   - Error logs and app logs contain no plaintext PII.

## 5) Rollback plan

- Keep the pre-migration database backup until production verification and retention windows are complete.
- For production, prefer batch-sized writes with an external migration ledger containing record id, field path, old ciphertext hash, new ciphertext hash, timestamp, and operator/change id. Store hashes only, not ciphertext or plaintext.
- If verification fails before traffic is resumed, restore the database snapshot or replay the ledger to replace new ciphertext with the previous ciphertext values from the secure backup process.
- If only a small batch fails, stop the migration, quarantine the batch ids, restore those fields from backup, and keep the app on the pre-migration deployment until root cause is fixed.
- Do not rotate the master key during this HKDF migration unless a separate key-rotation runbook and tests are ready.

## 6) Production safety checks

Before production migration:

- [ ] Change approved with a named owner, scheduled window, and rollback owner.
- [ ] Verified backup restore in staging.
- [ ] Read-only diagnostic completed with aggregate counts only.
- [ ] Migration write mode has tests and an explicit production confirmation guard.
- [ ] `KMS_PROVIDER=env` is not used in production.
- [ ] App, worker, and migration process use the same KMS provider and expected chain/environment config.
- [ ] PII endpoints are monitored for decrypt/auth failures without logging plaintext.
- [ ] All logs are checked for PII redaction before and after the migration.
- [ ] Support/comms plan is ready for temporary PII reveal unavailability.

After production migration:

- [ ] Aggregate counts match staging expectations.
- [ ] Sample authorized PII reveal flows succeed without plaintext logs.
- [ ] Receipt retention cleanup still runs.
- [ ] Migration ledger and backup retention dates are recorded.
