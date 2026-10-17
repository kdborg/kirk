# White-win rankings page

`index.html` is a static page: it loads `data.js` (the only file that changes) and shows one competition's table at a time,
chosen from the menu (newest first; the newest is the default; `#test4`-style links open a given competition).
Column headings sort.

To add a competition: put the organisers' CSV at `codecup/test<k>/results.csv` (competition_results.php?comp=N), add the
competition's entrant list (name -> program) to `codecup/competitions_meta.json` as the existing ones (the ranking table
of competition.php?comp=N), add the competition to the `comps` list in `codecup/white_wins_tables.py`, and run

    python3 codecup/white_wins_tables.py

which rewrites `data.js` (and the per-competition `test<k>.html` snippets, `test<k>.txt` Phorum versions and `tables.html`).
`data.js` is JSON behind `window.WW_DATA =`; it can also be edited by hand. Host `index.html` and `data.js` together;
opening `index.html` from disk works too (no server needed).
