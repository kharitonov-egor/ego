import csv
import io
from decimal import Decimal

CATEGORY = [
    ('AMAZON MKTPL', 'Shopping'),
    ('OPENAI', 'Subscriptions'),
    ('GRUBHUB', 'TakeOut'),
    ('UBER   *EATS', 'TakeOut'),
    ('McDonalds', 'TakeOut'),
    ('FLORIDA FRESH', 'Food'),
    ('WAWA', 'Food'),
    ('CIRCLEK', 'Food'),
    ('BULLS MARKET', 'Groceries'),
    ('BULL MARKET', 'Groceries'),
    ('COSTCO', 'Groceries'),
    ('USF PARKING', 'Car'),
    ('USFSBXLIBRARY', 'Education'),
    ('NAME-CHEAP.COM', 'Subscriptions'),
    ('WISPR', 'Subscriptions'),
    ('ANTHROPIC', 'Subscriptions'),
    ('DIGITALOCEAN', 'Subscriptions'),
    ('EA *ELECTRONIC ARTS', 'Fun'),
    ('AMC 9640', 'Fun'),
]

MERCHANT = [
    ('AMAZON MKTPL', 'Amazon'),
    ('OPENAI', 'OpenAI'),
    ('GRUBHUB', 'Grubhub'),
    ('UBER   *EATS', 'Uber Eats'),
    ('McDonalds', "McDonald's"),
    ('FLORIDA FRESH', 'Florida Fresh'),
    ('WAWA', 'Wawa'),
    ('CIRCLEK', 'Circle K'),
    ('BULLS MARKET', 'Bulls Market'),
    ('BULL MARKET', 'Bull Market'),
    ('COSTCO', 'Costco'),
    ('USF PARKING', 'USF Parking'),
    ('USFSBXLIBRARY', 'USF Library'),
    ('NAME-CHEAP.COM', 'Namecheap'),
    ('WISPR', 'Wispr Flow'),
    ('ANTHROPIC', 'Anthropic Claude'),
    ('DIGITALOCEAN', 'DigitalOcean'),
    ('EA *ELECTRONIC ARTS', 'Electronic Arts'),
    ('AMC 9640', 'AMC Theatres'),
]


def lookup(table, description, default=None):
    for needle, value in table:
        if needle in description:
            return value
    return default


def iso(posting):
    month, day, year = posting.split('/')
    return '%s-%s-%s' % (year, month, day)


rows = list(csv.DictReader(io.open('Chase5928_Activity_20260829.csv', encoding='utf-8')))
print('rows in file:', len(rows))

parsed = []
for row in rows:
    amount = Decimal(row['Amount'])
    parsed.append({
        'date': iso(row['Posting Date']),
        'description': row['Description'].strip(),
        'amount': amount,
        'type': row['Type'],
        'balance': Decimal(row['Balance']),
    })

print()
print('=== deposit cluster on 2026-08-17 ===')
for item in parsed:
    if abs(item['amount']) == Decimal('8700.00'):
        print('  %s  %+10s  %-22s  balance %s' % (
            item['date'], item['amount'], item['type'], item['balance']))
net = sum(item['amount'] for item in parsed if abs(item['amount']) == Decimal('8700.00'))
print('  net effect: %+s' % net)

kept = [item for item in parsed if abs(item['amount']) != Decimal('8700.00')]
kept.append({
    'date': '2026-08-17',
    'description': 'REMOTE ONLINE DEPOSIT #          1',
    'amount': Decimal('8700.00'),
    'type': 'CHECK_DEPOSIT',
    'balance': Decimal('8703.53'),
})
kept.sort(key=lambda item: item['date'])

print()
print('=== balance reconciliation ===')
last_balance = parsed[0]['balance']
first = parsed[-1]
opening = first['balance'] - first['amount']
print('  balance before earliest row (%s): %s' % (first['date'], opening))
total = sum(item['amount'] for item in kept)
print('  sum of %d imported rows:        %+s' % (len(kept), total))
print('  computed closing balance:       %s' % (opening + total))
print('  CSV latest balance:             %s' % last_balance)
print('  match:', opening + total == last_balance)

print()
print('=== categorization ===')
uncategorized = []
for item in sorted(kept, key=lambda i: i['date'], reverse=True):
    income = item['amount'] > 0
    category = 'INCOME' if income else lookup(CATEGORY, item['description'])
    merchant = lookup(MERCHANT, item['description'], item['description'][:28])
    if category is None:
        uncategorized.append(item)
    print('  %s  %9s  %-14s  %-18s  %s' % (
        item['date'], item['amount'], category or '???', merchant, item['type']))

print()
print('uncategorized:', len(uncategorized))
for item in uncategorized:
    print('  ', item['description'])

print()
print('=== income rows (need an income category name) ===')
for item in kept:
    if item['amount'] > 0:
        print('  %s  %+8s  %s' % (item['date'], item['amount'], item['description']))
