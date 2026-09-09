export function encodeCSV(rows) {
  return rows.map(row => row.map(value => {
    let text=String(value ?? '')
    // Spreadsheet apps can execute formula cells even when CSV-quoted.
    if(/^[\s\uFEFF]*[=+@-]/.test(text))text="'"+text
    return `"${text.replace(/"/g, '""')}"`
  }).join(',')).join('\n')
}
