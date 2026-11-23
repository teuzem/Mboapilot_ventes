import sqlite3
c = sqlite3.connect('sales.db')
c.row_factory = sqlite3.Row
for r in c.execute("SELECT name, sql FROM sqlite_master WHERE type='table'"):
    print('\n===', r['name'], '===')
    print(r['sql'])
    print('rows:', c.execute(f"SELECT COUNT(*) FROM {r['name']}").fetchone()[0])
print('\nUSERS:')
for r in c.execute("SELECT login,role,perimetre,actif,mfa_secret FROM users"):
    print(dict(r))
