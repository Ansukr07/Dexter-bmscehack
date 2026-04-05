import re

path = r'c:\Users\srini\Dexter-bmscehack\web\src\pages\Calibration.jsx'
with open(path, 'r', encoding='utf-8') as f:
    code = f.read()

# Replace classes
code = re.sub(r'className=\"btn btn-primary(.*?)\"', r'className=\"shdcn-button shdcn-button-primary\1\"', code)
code = re.sub(r'className=\"btn btn-ghost(.*?)\"', r'className=\"shdcn-button shdcn-button-ghost\1\"', code)
code = re.sub(r'className=\"btn(.*?)\"', r'className=\"shdcn-button\1\"', code)
code = re.sub(r'className=\"form-control\"', r'className=\"shdcn-input\"', code)
code = re.sub(r'className=\"card\"', r'className=\"stk-card\"', code)

# Replace alerts
code = re.sub(r'className=\"alert alert-info\"', r'style={{ background: "#f4f4f5", border: "1px solid #e8e8ea", color: "#111", padding: "12px 16px", borderRadius: "8px", fontSize: "13px", fontWeight: "500" }}', code)
code = re.sub(r'className=\"alert alert-success\"', r'style={{ background: "#f0fdf4", border: "1px solid #22c55e", color: "#15803d", padding: "12px 16px", borderRadius: "8px", fontSize: "13px", fontWeight: "500" }}', code)
code = re.sub(r'className=\"alert alert-error\"', r'style={{ background: "#fee2e2", border: "1px solid #ef4444", color: "#b91c1c", padding: "12px 16px", borderRadius: "8px", fontSize: "13px", fontWeight: "500" }}', code)
code = re.sub(r'className=\"alert alert-warning\"', r'style={{ background: "#fefce8", border: "1px solid #eab308", color: "#a16207", padding: "12px 16px", borderRadius: "8px", fontSize: "13px", fontWeight: "500" }}', code)

# Replace common colors
code = code.replace('"var(--cyan)"', '"#111"')
code = code.replace('"rgba(200,216,240,0.4)"', '"#737373"')
code = code.replace('"rgba(200,216,240,0.25)"', '"#a3a3a3"')
code = code.replace('"rgba(200,216,240,0.3)"', '"#a3a3a3"')
code = code.replace('"rgba(200,216,240,0.5)"', '"#737373"')
code = code.replace('"rgba(200,216,240,0.1)"', '"#f4f4f5"')
code = code.replace('"rgba(200,216,240,0.05)"', '"#fafafa"')
code = code.replace('"rgba(200,216,240,0.8)"', '"#111"')
code = code.replace('"rgba(99, 102, 241, 0.05)"', '"#f4f4f5"')
code = code.replace('"var(--bg-elevated)"', '"#fff"')
code = code.replace('"var(--bg-surface)"', '"#fff"')
code = code.replace('"var(--border)"', '"#e8e8ea"')
code = code.replace('"#e8f4ff"', '"#111"')
code = code.replace('"#0f172a"', '"#fff"')
code = code.replace('"#1e293b"', '"#f4f4f5"')
code = code.replace('"#334155"', '"#e4e4e7"')
code = code.replace('"#94a3b8"', '"#737373"')
code = code.replace('"#64748b"', '"#737373"')
code = code.replace('"#2dd4bf"', '"#000"')
code = code.replace('"#10b981"', '"#000"')  # green->black
code = code.replace('"#f59e0b"', '"#000"')  # yellow->black
code = code.replace('"#ef4444"', '"#000"')  # red->black

# Specific replacements for CSS text
code = code.replace('text-muted', 'color-[#737373]')

with open(path, 'w', encoding='utf-8') as f:
    f.write(code)
print('Done format update on Calibration.jsx')
