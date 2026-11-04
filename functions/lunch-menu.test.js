const test = require('node:test');
const assert = require('node:assert/strict');
const { menuMonthFromSource, parseLunchMenuText } = require('./lunch-menu');

// Excerpt of the real September 2026 On-Site PDF text: numbers alone on a line ("7"), after a space ("8 Pasta"),
// and glued to the next word ("14Chicken/"), a "NO SCHOOL" day, a month that wraps (28, 29, 30, 1, 2), and the footer.
const SEPT = `7
NO SCHOOL
8 Pasta & Mega
Swedish Meatball/
Veggieballs
Roasted Turkey &
Cheddar on Bun
9 Cheese Pizza
Roasted Turkey &
Cheddar on Bun
Served with
Seasoned
Green Beans
10
Honey Chipotle
Fish Sandwich
Soy Filet Sandwich
Served with
Potato Wedges
11 Grilled Cheese
Served with
Tomato Soup
Pizza Bento Box
14Chicken/ \tSoy
Alfredo Pasta
Turkey & Cheese
Bento Box
Served with
Roast Broccoli
15 Mac & Cheese
16
Chicken/ \tBaked
Soy Nuggets
17 MN Thursday
Beef Hot Dog
18 Teriyaki/ \tSoy
Chicken Nuggets
21
NO SCHOOL
22
Cheese Lasagna
23
Cheeseburger or
Hamburger
24Herb Roasted
Chicken Drumstick
25
Chicken/ \tBean &
Cheese Quesadilla
28Sweet & Sour
Chicken/ \tTofu
Served with
Seasoned
Green Beans
29
Beef/ \tFiesta
Crumble Nachos
30
Meatballs with
Marinara & Pasta
1
Chicken/ \tSoy Filet
Sandwich
2 Turkey Hot Dog
Pizza Bento Box
Served with
Potato Jojos
ON-SITE 2026 \tmpschools.org/menus
ENHANCE YOUR MEAL WITH FRESH
For nutrition facts and allergens, visit schoolcafe.com/
September Lunch\tSeptember Lunch
`;

const SEPT_MONTH = { year: 2026, month: 9 };
const byDate = r => Object.fromEntries(r.entries.map(e => [e.date, e.lunch]));

test('menu month comes from the PDF file name, else from its text', () => {
  assert.deepEqual(menuMonthFromSource('https://x.net/a/Menu_Lunch_Sept2026_OS.pdf', ''), { year: 2026, month: 9 });
  assert.deepEqual(menuMonthFromSource('https://x.net/a/Menu_Lunch_Nov2026_01.pdf?v=2', ''), { year: 2026, month: 11 });
  assert.deepEqual(menuMonthFromSource('https://x.net/a/menu.pdf', 'ON-SITE 2026 x\nOctober Lunch\tOctober Lunch'), { year: 2026, month: 10 });
  assert.equal(menuMonthFromSource('https://x.net/a/menu.pdf', 'nothing useful'), null);
});

test('each day gets its own block of text, however its number is laid out', () => {
  const r = parseLunchMenuText(SEPT, SEPT_MONTH);
  const days = byDate(r);
  assert.equal(days['2026-09-08'], 'Pasta & Mega Swedish Meatball/ Veggieballs Roasted Turkey & Cheddar on Bun');
  assert.equal(days['2026-09-09'], 'Cheese Pizza Roasted Turkey & Cheddar on Bun Served with Seasoned Green Beans');
  assert.equal(days['2026-09-10'], 'Honey Chipotle Fish Sandwich Soy Filet Sandwich Served with Potato Wedges');
  assert.equal(days['2026-09-14'], 'Chicken/ Soy Alfredo Pasta Turkey & Cheese Bento Box Served with Roast Broccoli');
  assert.equal(days['2026-09-28'], 'Sweet & Sour Chicken/ Tofu Served with Seasoned Green Beans');
});

test('no-school days are skipped, not saved as a lunch', () => {
  const r = parseLunchMenuText(SEPT, SEPT_MONTH);
  assert.ok(!('2026-09-07' in byDate(r)) && !('2026-09-21' in byDate(r)));
  assert.deepEqual(r.skipped, [{ date: '2026-09-07', reason: 'no school' }, { date: '2026-09-21', reason: 'no school' }]);
});

test('days after the month ends land in the next month, and the footer is not part of the last day', () => {
  const days = byDate(parseLunchMenuText(SEPT, SEPT_MONTH));
  assert.equal(days['2026-10-01'], 'Chicken/ Soy Filet Sandwich');
  assert.equal(days['2026-10-02'], 'Turkey Hot Dog Pizza Bento Box Served with Potato Jojos');
});

test('a PDF that starts mid-week with no leading numbers is read from its first day', () => {
  const nov = `2\nChicken/ Cheese\nTamale\n3\nNo School\n4\nCheese Pizza\n5 Honey Chipotle\nFish Sandwich\n6 Grilled Cheese\n9 Chicken/\nSoy Alfredo\nON-SITE 2026`;
  const r = parseLunchMenuText(nov, { year: 2026, month: 11 });
  assert.equal(byDate(r)['2026-11-02'], 'Chicken/ Cheese Tamale');
  assert.equal(byDate(r)['2026-11-09'], 'Chicken/ Soy Alfredo');
  assert.deepEqual(r.skipped, [{ date: '2026-11-03', reason: 'no school' }]);
});

test('a number inside a dish that is not the next weekday does not start a day', () => {
  const text = `1\nTacos\n2\nPizza\n100% Juice\n3 Fruit Cups\n5\nSoup\n6\nChili\n7\nRice\n8\nPasta`;
  const r = parseLunchMenuText(text, { year: 2026, month: 10 }); // Oct 1 2026 is a Thursday; the next weekday after Fri the 2nd is Mon the 5th
  assert.equal(byDate(r)['2026-10-02'], 'Pizza 100% Juice 3 Fruit Cups');
  assert.equal(byDate(r)['2026-10-05'], 'Soup');
});

test('text that is not the expected calendar yields nothing rather than a guess', () => {
  assert.deepEqual(parseLunchMenuText('Closed for the summer. See you in the fall!', SEPT_MONTH).entries, []);
  assert.deepEqual(parseLunchMenuText('6\nSaturday thing\n7\nSunday thing', SEPT_MONTH).entries, []);
  assert.deepEqual(parseLunchMenuText('', SEPT_MONTH).entries, []);
});

test('a day with unexpectedly long text (footer not cut) is skipped', () => {
  const long = 'x '.repeat(200);
  const text = `7\nA\n8\nB\n9\nC\n10\nD\n11\nE\n14\n${long}`;
  const r = parseLunchMenuText(text, SEPT_MONTH);
  assert.ok(!('2026-09-14' in byDate(r)));
  assert.deepEqual(r.skipped, [{ date: '2026-09-14', reason: 'text too long to trust' }]);
});
