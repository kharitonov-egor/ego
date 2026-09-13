-- Baseline money schema. Matches the tables the desktop and mobile clients already created.
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
  kind TEXT NOT NULL CHECK(kind IN ('checking', 'savings', 'cash', 'credit-card', 'investment', 'crypto', 'other')),
  icon TEXT NOT NULL,
  color TEXT NOT NULL,
  opening_balance_cents INTEGER NOT NULL,
  opening_date TEXT NOT NULL CHECK(opening_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
  kind TEXT NOT NULL CHECK(kind IN ('income', 'expense')),
  icon TEXT NOT NULL,
  color TEXT NOT NULL,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('income', 'expense', 'transfer')),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  destination_account_id TEXT REFERENCES accounts(id),
  category_id TEXT REFERENCES categories(id),
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  date TEXT NOT NULL CHECK(date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  notes TEXT NOT NULL DEFAULT '' CHECK(length(notes) <= 500),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(
    (kind = 'transfer' AND destination_account_id IS NOT NULL AND destination_account_id <> account_id AND category_id IS NULL)
    OR
    (kind IN ('income', 'expense') AND destination_account_id IS NULL AND category_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
  merchant TEXT NOT NULL CHECK(length(trim(merchant)) BETWEEN 1 AND 120),
  purchase_date TEXT NOT NULL CHECK(purchase_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  currency TEXT NOT NULL CHECK(currency = 'USD'),
  subtotal_cents INTEGER NOT NULL CHECK(subtotal_cents >= 0),
  discount_cents INTEGER NOT NULL CHECK(discount_cents >= 0),
  tax_cents INTEGER NOT NULL CHECK(tax_cents >= 0),
  fees_cents INTEGER NOT NULL CHECK(fees_cents >= 0),
  total_cents INTEGER NOT NULL CHECK(total_cents > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS receipt_items (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK(position >= 0),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160),
  quantity REAL NOT NULL CHECK(quantity > 0),
  unit_price_cents INTEGER CHECK(unit_price_cents IS NULL OR unit_price_cents >= 0),
  gross_price_cents INTEGER NOT NULL CHECK(gross_price_cents >= 0),
  discount_cents INTEGER NOT NULL CHECK(discount_cents >= 0),
  line_total_cents INTEGER NOT NULL CHECK(line_total_cents >= 0),
  UNIQUE(purchase_id, position)
);

CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY,
  month TEXT NOT NULL UNIQUE CHECK(month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  planned_income_cents INTEGER NOT NULL CHECK(planned_income_cents >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS budget_allocations (
  id TEXT PRIMARY KEY,
  budget_id TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id),
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  UNIQUE(budget_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_destination ON transactions(destination_account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(purchase_date DESC);
CREATE INDEX IF NOT EXISTS idx_receipt_items_purchase ON receipt_items(purchase_id, position);
CREATE INDEX IF NOT EXISTS idx_budget_allocations_budget ON budget_allocations(budget_id);
