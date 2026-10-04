import csv
import sys
from decimal import Decimal

USAGE = '''usage: python scripts/analyze-chase.py <chase-export.csv> [rules.csv]

rules.csv has a header row of match,category,merchant. A row applies when its match text
appears in the transaction description. Keep both files as .csv so .gitignore keeps them
out of the repo.'''


def load_rules(path):
    if path is None:
        return []
    with open(path, encoding='utf-8', newline='') as handle:
        return [
            (row['match'], row['category'], row.get('merchant') or row['match'])
            for row in csv.DictReader(handle)
            if row.get('match')
        ]


def lookup(rules, description):
    for needle, category, merchant in rules:
        if needle in description:
            return category, merchant
    return None, description[:28]


def iso(posting):
    month, day, year = posting.split('/')
    return '%s-%s-%s' % (year, month, day)


if len(sys.argv) not in (2, 3):
    sys.exit(USAGE)

with open(sys.argv[1], encoding='utf-8', newline='') as handle:
    rows = list(csv.DictReader(handle))
rules = load_rules(sys.argv[2] if len(sys.argv) == 3 else None)
print('rows in file:', len(rows))
if not rows:
    sys.exit(0)

parsed = [{
    'date': iso(row['Posting Date']),
    'description': row['Description'].strip(),
    'amount': Decimal(row['Amount']),
    'type': row['Type'],
    'balance': Decimal(row['Balance']),
} for row in rows]

print()
print('=== balance reconciliation ===')
last_balance = parsed[0]['balance']
first = parsed[-1]
opening = first['balance'] - first['amount']
total = sum(item['amount'] for item in parsed)
print('  balance before earliest row (%s): %s' % (first['date'], opening))
print('  sum of %d rows:                 %+s' % (len(parsed), total))
print('  computed closing balance:       %s' % (opening + total))
print('  CSV latest balance:             %s' % last_balance)
print('  match:', opening + total == last_balance)

print()
print('=== categorization ===')
uncategorized = []
for item in sorted(parsed, key=lambda i: i['date'], reverse=True):
    category, merchant = lookup(rules, item['description'])
    if item['amount'] > 0:
        category = 'INCOME'
    elif category is None:
        uncategorized.append(item)
    print('  %s  %9s  %-14s  %-18s  %s' % (
        item['date'], item['amount'], category or '???', merchant, item['type']))

print()
print('uncategorized:', len(uncategorized))
for item in uncategorized:
    print('  ', item['description'])

print()
print('=== income rows (need an income category name) ===')
for item in parsed:
    if item['amount'] > 0:
        print('  %s  %+8s  %s' % (item['date'], item['amount'], item['description']))
