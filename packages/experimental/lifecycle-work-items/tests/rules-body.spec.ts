import { describe, expect, it } from 'vitest'
import {
  BUG_003,
  PL_009,
  REQ_009,
  REQ_010,
  RV_009,
  TC_008_12,
  TC_009_01,
  editBody,
  lintWorkspace,
  messages,
  ofRule,
  removeFile,
  replaceSection,
  setField,
  type Files,
} from './lint-helper.ts'

describe('REQ body rules', () => {
  it('leave the compliant live REQ alone', () => {
    const violations = lintWorkspace()
    expect(violations).toEqual([])
  })

  it.each<[string, (files: Files) => unknown, string, RegExp]>([
    ['a banned heading', files => editBody(files, REQ_010, body => body.replace('## Goal', '## Background')), 'req-body', /contains banned H2 heading 'Background'/],
    ['sections out of order', files => editBody(files, REQ_010, body => body.replace('## Goal', '## Goal!')), 'req-body', /H2 headings are not the seven sections in order; expected \[Goal, Behavior, Non-goals, Acceptance criteria, Pending decisions, Design references, Bug History\], got \[Goal!, Behavior, Non-goals/],
    ['a repeated heading', files => editBody(files, REQ_010, body => body.replace('## Bug History', '## Goal')), 'req-body', /H2 heading 'Goal' appears more than once/],
    ['a body without H2 headings', files => editBody(files, REQ_010, body => body.replace(/^## /gm, '#### ')), 'req-body', /H2 headings are not the seven sections in order; expected \[Goal, Behavior, Non-goals, Acceptance criteria, Pending decisions, Design references, Bug History\], got \[\]/],
    ['no acceptance entries', files => replaceSection(files, REQ_010, 'Acceptance criteria', 'Nothing here yet.'), 'req-body', /Acceptance criteria has no '- \*\*AC-…\*\*' entry; an empty set is not a verifiable requirement/],
    ['an empty Non-goals section', files => replaceSection(files, REQ_010, 'Non-goals', '<!-- later -->'), 'req-body', /Non-goals must not be empty/],
    ['an H3 outside Behavior', files => replaceSection(files, REQ_010, 'Goal', '### Detail\nText.'), 'req-body', /H3 heading 'Detail' appears inside Goal; only Behavior may contain H3 headings/],
    ['an H3 before any section', files => editBody(files, REQ_010, body => `### Early\n${body}`), 'req-body', /H3 heading 'Early' appears inside \(start of body\); only Behavior may contain H3 headings/],
    ['a section over budget', files => replaceSection(files, REQ_010, 'Goal', 'x'.repeat(2100)), 'req-budgets', /section 'Goal' is 21\d\d characters, over the budget of 2000/],
    ['a body over budget', files => replaceSection(files, REQ_010, 'Behavior', 'y'.repeat(14990) + '\n' + 'z'.repeat(20100)), 'req-budgets', /body is 3\d\d\d\d characters, over the budget of 35000/],
    ['an acceptance item over budget', files => replaceSection(files, REQ_010, 'Acceptance criteria', `- **AC-PLAT-010-01** ${'w'.repeat(600)}`), 'req-budgets', /acceptance item AC-PLAT-010-01 is 6\d\d characters, over the budget of 600/],
    ['a malformed acceptance bullet', files => replaceSection(files, REQ_010, 'Acceptance criteria', '- **AC-PLAT-010-01** fine\n* AC-PLAT-010-02 not bold'), 'ac-ids', /top-level entry 'AC-PLAT-010-02 not bold' in Acceptance criteria is not of the form - \*\*AC-<PREFIX>-NNN-SS\*\* \(bold, starting with AC, a space after \*\*\)/],
    ['an acceptance id of another REQ', files => replaceSection(files, REQ_010, 'Acceptance criteria', '- **AC-PLAT-011-01** borrowed'), 'ac-ids', /acceptance id AC-PLAT-011-01 must be AC-<PREFIX>-NNN-SS with the owning REQ's prefix and number/],
    ['an acceptance id repeated in the REQ', files => replaceSection(files, REQ_010, 'Acceptance criteria', '- **AC-PLAT-010-01** one\n- **AC-PLAT-010-01** again'), 'ac-ids', /acceptance id AC-PLAT-010-01 is duplicated within this REQ/],
    ['an acceptance id owned by another REQ', files => replaceSection(files, REQ_010, 'Acceptance criteria', '- **AC-PLAT-009-01** taken'), 'ac-ids', /acceptance id AC-PLAT-009-01 duplicates lifecycle\/tasks\/archive\/done\/REQ-PLAT-009\.md; ids are unique across the tasks tree/],
    ['acceptance ids out of order', files => replaceSection(files, REQ_010, 'Acceptance criteria', '- **AC-PLAT-010-02** two\n- **AC-PLAT-010-01** one'), 'ac-ids', /acceptance id AC-PLAT-010-01 does not increase \(the previous item was 02\)/],
    ['a CLI flag in the intent', files => setField(files, REQ_010, 'intent', '"Run with --verbose"'), 'how-lexicon', /intent hits the implementation lexicon 'CLI flag': '--verbose'/],
    ['an HTTP status in the acceptance', files => setField(files, REQ_010, 'acceptance', '"The service answers HTTP 422"'), 'how-lexicon', /acceptance hits the implementation lexicon 'exit code \/ HTTP status': 'HTTP 422'/],
    ['a code path in the body', files => replaceSection(files, REQ_010, 'Goal', 'See src/lint/rules.ts for the truth.'), 'how-lexicon', /Goal hits the implementation lexicon 'code path': 'src\/lint\/rules\.ts'/],
    ['a code fence outside Design references', files => replaceSection(files, REQ_010, 'Goal', '```\ncode\n```'), 'how-lexicon', /Goal contains a code fence; only Design references allows one/],
    ['pending decisions outside req_review', files => replaceSection(files, REQ_010, 'Pending decisions', '- **Q-01** (planner-001, 2026-09-13) Which? | Options A / B | Default A | Deadline 2026-09-20'), 'pending-decisions', /Pending decisions is not 'None' while status is 'draft'; only req_review may have pending decisions/],
  ])('names %s', (_case, edit, rule, expected) => {
    expect(messages(rule, edit)).toMatch(expected)
  })

  it('allows allowed terms, error classes, and the Design references section to carry implementation words', () => {
    const violations = lintWorkspace((files) => {
      replaceSection(files, REQ_010, 'Goal', 'A `ConfigError` names the field; `422` is an allowed term when registered.')
      replaceSection(files, REQ_010, 'Design references', '- see src/lint/rules.ts and `--flag` and ```fenced```')
      setField(files, REQ_010, 'acceptance', '"[link text](../../docs/src/x.py) stays out of the scan"')
    })
    expect(ofRule(violations, 'how-lexicon').map(violation => violation.message)).toEqual([
      "Goal hits the implementation lexicon 'exit code / HTTP status': '422'",
    ])
  })

  it.each<[string, string, RegExp]>([
    ['an indented line before any entry', '  stray note\n- **Q-01** (planner-001, 2026-09-13) Which? | Options A / B | Default A | Deadline 2026-09-20', /indented line 'stray note' in Pending decisions has no preceding top-level Q-NN entry/],
    ['a top-level line that is not an entry', 'We still wonder.', /'We still wonder\.' in Pending decisions is not a Q-NN entry; the section is either exactly 'None' or every non-blank line is an entry/],
    ['no entries at all', '<!-- soon -->\nText', /Pending decisions is not 'None' yet has no top-level Q-NN entry/],
    ['a malformed entry', '- **Q-01** planner asks', /entry 'Q-01' is malformed; it should be - \*\*Q-NN\*\* \(proposer, YYYY-MM-DD\) question \| Options … \| Default … \| Deadline YYYY-MM-DD/],
    ['a malformed entry without an id', '- nothing decided here yet at all', /entry '- nothing decided he' is malformed/],
    ['an entry with an empty question', '- **Q-01** (planner-001, 2026-09-13) | Options A / B | Default A | Deadline 2026-09-20', /entry Q-01 segment 'question' is empty/],
    ['an entry with an empty deadline', '- **Q-01** (planner-001, 2026-09-13) Which? | Options A / B | Default A |', /entry Q-01 segment 'Deadline' is empty$/m],
    ['an entry without a proposer', '- **Q-01** (, 2026-09-13) Which? | Options A / B | Default A | Deadline 2026-09-20', /entry Q-01 has an empty proposer; the parentheses must name a person/],
    ['an entry with an impossible date', '- **Q-01** (planner-001, 2026-13-01) Which? | Options A / B | Default A | Deadline 2026-09-20', /entry Q-01 proposal date '2026-13-01' is not a valid calendar date/],
    ['an entry with three segments', '- **Q-01** (planner-001, 2026-09-13) Which? | Options A / B | Default A', /entry Q-01 has 3 segments; it must have exactly four: question \| Options \| Default \| Deadline/],
    ['an entry with an empty segment', '- **Q-01** (planner-001, 2026-09-13) Which? | | Default A | Deadline 2026-09-20', /entry Q-01 segment 'Options' is empty/],
    ['a segment without its label', '- **Q-01** (planner-001, 2026-09-13) Which? | Choose A / B | Default A | Deadline 2026-09-20', /entry Q-01 segment 2 'Choose A \/ B' does not start with 'Options'/],
    ['a segment with only its label', '- **Q-01** (planner-001, 2026-09-13) Which? | Options A / B | Default | Deadline 2026-09-20', /entry Q-01 segment 'Default' has only its label and no content/],
    ['a deadline without a date', '- **Q-01** (planner-001, 2026-09-13) Which? | Options A / B | Default A | Deadline soon', /entry Q-01 deadline 'Deadline soon' has no valid YYYY-MM-DD date/],
  ])('names %s in a req_review REQ', (_case, section, expected) => {
    const found = messages('pending-decisions', (files) => {
      setField(files, REQ_010, 'status', 'req_review')
      setField(files, REQ_010, 'owner', 'planner-001')
      replaceSection(files, REQ_010, 'Pending decisions', section)
    })
    expect(found).toMatch(expected)
  })

  it('accepts a well-formed entry with continuation lines while the REQ is in req_review', () => {
    const found = messages('pending-decisions', (files) => {
      setField(files, REQ_010, 'status', 'req_review')
      setField(files, REQ_010, 'owner', 'planner-001')
      replaceSection(files, REQ_010, 'Pending decisions', '- **Q-01** (planner-001, 2026-09-13) Which store? | Options SQLite / files | Default files | Deadline 2026-09-20\n  more context')
    })
    expect(found).toBe('')
  })

  it('does not judge archived or legacy bodies', () => {
    const violations = lintWorkspace((files) => {
      editBody(files, REQ_009, body => body.replace('## Goal', '## Background'))
      replaceSection(files, REQ_009, 'Acceptance criteria', '- **AC-PLAT-011-01** borrowed\n* loose\n- **AC-PLAT-009-02** two\n- **AC-PLAT-009-01** one\n- **AC-PLAT-009-01** again')
    })
    expect(ofRule(violations, 'req-body')).toEqual([])
    expect(ofRule(violations, 'req-budgets')).toEqual([])
    expect(ofRule(violations, 'how-lexicon')).toEqual([])
    expect(ofRule(violations, 'pending-decisions')).toEqual([])
    expect(ofRule(violations, 'ac-ids').map(violation => violation.message)).toEqual(['acceptance id AC-PLAT-009-01 is duplicated within this REQ'])
  })
})

describe('PL rules', () => {
  it.each<[string, (files: Files) => unknown, RegExp]>([
    ['an extra frontmatter field', (files) => { files[PL_009] = String(files[PL_009]).replace('linked_req: REQ-PLAT-009', 'linked_req: REQ-PLAT-009\nowner: planner-001') }, /frontmatter has extra field 'owner'; only \[pl_id, tool, linked_req\] are allowed/],
    ['a missing frontmatter field', (files) => { files[PL_009] = String(files[PL_009]).replace('tool: platform\n', '') }, /frontmatter lacks field 'tool'/],
    ['a pl_id unlike the file name', files => setField(files, PL_009, 'pl_id', 'PL-PLAT-090'), /pl_id 'PL-PLAT-090' does not match the file name/],
    ['a tool unlike the directory', files => setField(files, PL_009, 'tool', 'canonical-bom'), /tool 'canonical-bom' does not match the directory 'platform'/],
    ['a linked_req with another number', files => setField(files, PL_009, 'linked_req', 'REQ-PLAT-008'), /linked_req 'REQ-PLAT-008' should be the same-numbered REQ-PLAT-009/],
    ['an orphan plan', (files) => { files['lifecycle/tasks/plans/platform/PL-PLAT-777.md'] = String(files[PL_009]).replace(/PL-PLAT-009/g, 'PL-PLAT-777').replace('REQ-PLAT-009', 'REQ-PLAT-777') }, /linked_req REQ-PLAT-777 does not resolve to an existing REQ; orphan PL/],
    ['a missing fixed heading', files => editBody(files, PL_009, body => body.replace('## Test support', '## Testing')), /body lacks fixed H2 heading 'Test support'/],
    ['a heading outside the four', files => editBody(files, PL_009, body => body.replace('## Test support', '## Testing')), /body contains H2 heading 'Testing' outside the fixed four/],
    ['headings out of order', files => editBody(files, PL_009, body => body.replace('## Test support', '## Risks and open technical points').replace(/## Risks and open technical points(?![\s\S]*## Risks)/, '## Test support')), /the four fixed H2 headings must appear once each in order; got \[Contract changes, Module placement and slices, Risks and open technical points, Test support\]/],
    ['a body over budget', files => editBody(files, PL_009, body => `${body}\n${'p'.repeat(15000)}`), /body is \d+ characters, over the budget of 15000/],
  ])('names %s', (_case, edit, expected) => {
    expect(messages('pl', edit)).toMatch(expected)
  })

  it('does not call a plan orphan while the tree has no REQ at all', () => {
    const violations = lintWorkspace((files) => {
      for (const path of Object.keys(files)) if (/\/REQ-[A-Z]+-\d{3}\.md$/.test(path)) removeFile(files, path)
    })
    expect(ofRule(violations, 'pl')).toEqual([])
  })
})

describe('link rules', () => {
  it.each<[string, (files: Files) => unknown, RegExp]>([
    ['a missing target in a v2 REQ', files => replaceSection(files, REQ_010, 'Design references', '- [gone](../../plans/platform/PL-PLAT-404.md)'), /REQ-PLAT-010\.md: link '\.\.\/\.\.\/plans\/platform\/PL-PLAT-404\.md' points to a missing file/],
    ['a directory target', files => replaceSection(files, REQ_010, 'Design references', '- [dir](../../plans)'), /link '\.\.\/\.\.\/plans' points to a directory, not a file/],
    ['an absolute path', files => replaceSection(files, REQ_010, 'Design references', '- [abs](/etc/hosts)'), /link '\/etc\/hosts' is an absolute path; only workspace-relative links are allowed/],
    ['a target outside the workspace', files => replaceSection(files, REQ_010, 'Design references', '- [out](../../../../../secrets.md)'), /link '\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/secrets\.md' escapes the workspace/],
    ['a reference-style use without its definition', files => replaceSection(files, REQ_010, 'Design references', '- see [the plan][plan]'), /reference-style link '\[the plan\]\[plan\]' has no matching definition in the file/],
    ['a missing target in a plan', files => editBody(files, PL_009, body => body.replace('ADR-011-cross-vendor-evaluator.md', 'ADR-099.md')), /PL-PLAT-009\.md: link '\.\.\/\.\.\/\.\.\/\.\.\/docs\/adr\/ADR-099\.md' points to a missing file/],
    ['the workspace root\'s parent as a target', files => replaceSection(files, REQ_010, 'Design references', '- [up](../../../../..)'), /link '\.\.\/\.\.\/\.\.\/\.\.\/\.\.' escapes the workspace/],
    ['a backslash before a letter kept in the target', files => replaceSection(files, REQ_010, 'Design references', '- [kept](../../plans/platform/PL-PLAT-009.md\\z)'), /link '\.\.\/\.\.\/plans\/platform\/PL-PLAT-009\.md\\z' points to a missing file/],
    ['a missing target in a BUG', (files) => { files[BUG_003] = String(files[BUG_003]).replace('RV-PLAT-009.md#req_impl_review', 'RV-PLAT-404.md#req_impl_review') }, /BUG-PLAT-003\.md: link '\.\.\/\.\.\/reviews\/platform\/RV-PLAT-404\.md#req_impl_review' points to a missing file/],
    ['a missing target in an RV', (files) => { files[RV_009] = `${String(files[RV_009])}\n[gone](../../nowhere.md)\n` }, /RV-PLAT-009\.md: link '\.\.\/\.\.\/nowhere\.md' points to a missing file/],
    ['a missing target in a TC of a v2 REQ', (files) => { files[TC_009_01] = `${String(files[TC_009_01])}\n[gone](../../nowhere.md)\n` }, /TC-PLAT-009-01\.md: link '\.\.\/\.\.\/nowhere\.md' points to a missing file/],
  ])('names %s', (_case, edit, expected) => {
    expect(messages('links', edit)).toMatch(expected)
  })

  it('resolves reference definitions, skips code and external links, and ignores legacy bodies', () => {
    const violations = lintWorkspace((files) => {
      replaceSection(files, REQ_010, 'Design references', [
        '- [the plan][plan] and [collapsed][] and <https://example.com/x> and [mail](mailto:a@b.c) and [web](https://example.com/y)',
        '- `[code](../../nowhere.md)` stays out',
        '- [top](#goal) and [angle](<../../plans/platform/PL-PLAT-009.md> "titled") and [escaped](../../plans/platform/PL-PLAT-009\\.md) and [paren](../../plans/platform/PL-PLAT-009.md "(with) parens")',
        '',
        '[plan]: ../../plans/platform/PL-PLAT-009.md "Plan"',
        '[collapsed]: <../../plans/platform/PL-PLAT-009.md>',
      ].join('\n'))
      files['lifecycle/tasks/features/canonical-bom/REQ-CBOM-021.md'] = String(files['lifecycle/tasks/features/canonical-bom/REQ-CBOM-021.md']).replace('## Design references', '## Design references\n\n- [gone](../../nowhere.md)')
      files[TC_008_12] = `${String(files[TC_008_12])}\n[gone](../../nowhere.md)\n`
      files['lifecycle/tasks/test-cases/platform/TC-PLAT-404-01.md'] = [
        '---', 'tc_id: TC-PLAT-404-01', 'tool: platform', 'linked_req: REQ-PLAT-404', 'title: t', 'status: draft', 'level: unit',
        'owner: evaluator-001', 'automated: true', '---', '', '[gone](../../nowhere.md)', '',
      ].join('\n')
    })
    expect(ofRule(violations, 'links')).toEqual([])
  })
})
