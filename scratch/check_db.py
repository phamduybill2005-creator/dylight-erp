import sqlite3

conn = sqlite3.connect('backend/dev.db')
cursor = conn.cursor()
cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
print("Tables:", cursor.fetchall())

try:
    cursor.execute("SELECT id, code, name, group_name FROM projects")
    rows = cursor.fetchall()
    print("Total projects:", len(rows))
    for r in rows:
        print(r)
except Exception as e:
    print("Error querying projects:", e)
