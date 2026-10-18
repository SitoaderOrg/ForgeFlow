import { describe, expect, it } from 'vitest';
import {
  createContext,
  createGitHub,
  makeAgentRun,
  makePR,
  makeRun,
  quality,
  seedQualityStatus
} from './helpers/harness.js';

describe('pr-quality.cjs revision', () => {
  const base = makePR({ sha: 'abcdef1234567890abcdef1234567890abcdef12' });

  it('is <sha7>.<8 hex metadata hash>', () => {
    expect(quality.revision(base)).toMatch(/^abcdef1\.[0-9a-f]{8}$/);
  });

  it('changes when the head commit, title or body changes', () => {
    const rev = quality.revision(base);
    expect(
      quality.revision({
        ...base,
        head: { sha: 'bbbbbbb' + base.head.sha.slice(7) }
      })
    ).not.toBe(rev);
    expect(quality.revision({ ...base, title: 'fix: other' })).not.toBe(rev);
    expect(quality.revision({ ...base, body: 'new body' })).not.toBe(rev);
  });

  it('changes when a decision label is added, but not for other labels', () => {
    const rev = quality.revision(base);
    expect(
      quality.revision({
        ...base,
        labels: [{ name: 'lint-failed' }, { name: 'docs-required' }]
      })
    ).toBe(rev);
    expect(
      quality.revision({ ...base, labels: [{ name: 'docs-not-required' }] })
    ).not.toBe(rev);
  });

  it('accepts string labels and ignores label order', () => {
    expect(
      quality.revision({ ...base, labels: ['docs-not-required', 'x'] })
    ).toBe(
      quality.revision({
        ...base,
        labels: [{ name: 'x' }, { name: 'docs-not-required' }]
      })
    );
  });

  it('treats missing title/body as empty strings', () => {
    expect(
      quality.revision({ head: base.head, title: null, body: undefined })
    ).toBe(quality.revision({ head: base.head, title: '', body: '' }));
  });
});

describe('pr-quality.cjs parseRevision', () => {
  it.each([
    ['All gates passed [rev abcdef1.0123abcd]', 'abcdef1.0123abcd'],
    ['no revision here', null],
    ['[rev ABCDEF1.0123ABCD]', null],
    ['', null],
    [undefined, null]
  ])('parses %j', (description, expected) => {
    expect(quality.parseRevision(description)).toBe(expected);
  });
});

describe('pr-quality.cjs commit status', () => {
  it('round-trips state, revision and target URL', async () => {
    const pr = makePR();
    const github = createGitHub({ pulls: [pr] });
    const rev = await seedQualityStatus(github, pr, 'failure', 'Failed: Lint');
    const status = await quality.getQualityStatus({
      github,
      context: createContext(),
      sha: pr.head.sha
    });
    expect(status).toMatchObject({
      state: 'failure',
      revision: rev,
      final: true,
      description: `Failed: Lint [rev ${rev}]`
    });
  });

  it('marks pending as not final and returns the newest status', async () => {
    const pr = makePR();
    const github = createGitHub({ pulls: [pr] });
    await seedQualityStatus(github, pr, 'failure');
    await seedQualityStatus(github, pr, 'pending');
    const status = await quality.getQualityStatus({
      github,
      context: createContext(),
      sha: pr.head.sha
    });
    expect(status.state).toBe('pending');
    expect(status.final).toBe(false);
  });

  it('ignores statuses with another context and returns null when absent', async () => {
    const pr = makePR();
    const github = createGitHub({
      statuses: {
        [pr.head.sha]: [
          { context: 'ci/other', state: 'success', description: 'x' }
        ]
      }
    });
    expect(
      await quality.getQualityStatus({
        github,
        context: createContext(),
        sha: pr.head.sha
      })
    ).toBeNull();
  });

  it('keeps descriptions within 140 characters without losing the revision', async () => {
    const pr = makePR();
    const github = createGitHub();
    const rev = quality.revision(pr);
    await quality.setQualityStatus({
      github,
      context: createContext(),
      sha: pr.head.sha,
      state: 'failure',
      summary: 'Failed: '.padEnd(400, 'x'),
      rev,
      targetUrl: 'u'
    });
    const [status] = github.qualityStatuses(pr.head.sha);
    expect(status.description.length).toBeLessThanOrEqual(140);
    expect(quality.parseRevision(status.description)).toBe(rev);
    expect(status.context).toBe('pr-quality');
  });
});

describe('pr-quality.cjs pendingRemediationRuns', () => {
  const branch = 'feat/sample';
  const pending = (github, excludeRunId) =>
    quality.pendingRemediationRuns({
      github,
      context: createContext(),
      branch,
      excludeRunId
    });

  it('returns nothing when no agent is running', async () => {
    const github = createGitHub({
      runs: [makeRun({ id: 1, workflow: 'pr-lint-fixer.lock.yml', branch })]
    });
    expect(await pending(github)).toEqual([]);
  });

  it('reports queued agents and agents still working', async () => {
    const github = createGitHub({
      runs: [
        makeAgentRun({
          id: 1,
          workflow: 'pr-lint-fixer.lock.yml',
          branch,
          phase: 'queued'
        }),
        makeAgentRun({
          id: 2,
          workflow: 'pr-test-generator.lock.yml',
          branch,
          phase: 'agent'
        })
      ]
    });
    expect((await pending(github)).map((p) => [p.workflow, p.id])).toEqual([
      ['pr-lint-fixer.lock.yml', 1],
      ['pr-test-generator.lock.yml', 2]
    ]);
  });

  it('treats an agent whose conclusion job started as handed off', async () => {
    const github = createGitHub({
      runs: [
        makeAgentRun({
          id: 1,
          workflow: 'pr-doc-updater.lock.yml',
          branch,
          phase: 'conclusion'
        })
      ]
    });
    expect(await pending(github)).toEqual([]);
  });

  it('excludes the run that dispatched the relay', async () => {
    const github = createGitHub({
      runs: [
        makeAgentRun({ id: 42, workflow: 'pr-validation.lock.yml', branch })
      ]
    });
    expect(await pending(github, 42)).toEqual([]);
    expect(await pending(github, 43)).toHaveLength(1);
  });

  it('ignores agents on other branches and non-dispatch runs', async () => {
    const github = createGitHub({
      runs: [
        makeAgentRun({
          id: 1,
          workflow: 'pr-lint-fixer.lock.yml',
          branch: 'other'
        }),
        {
          ...makeAgentRun({
            id: 2,
            workflow: 'pr-lint-fixer.lock.yml',
            branch
          }),
          event: 'push'
        }
      ]
    });
    expect(await pending(github)).toEqual([]);
  });

  it('skips agent workflows that do not exist on the branch (404)', async () => {
    const github = createGitHub({
      missingWorkflows: ['pr-secret-fixer.lock.yml'],
      runs: [
        makeAgentRun({ id: 1, workflow: 'pr-lint-fixer.lock.yml', branch })
      ]
    });
    expect(await pending(github)).toHaveLength(1);
  });

  it('lists every remediation agent workflow', () => {
    expect(quality.REMEDIATION_WORKFLOWS).toHaveLength(7);
    expect(quality.DECISION_LABELS).toEqual(['docs-not-required']);
  });
});
