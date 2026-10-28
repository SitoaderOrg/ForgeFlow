import {
  SCENARIOS,
  describeScenario,
  resolveScenario
} from './game/scenarios.js';

export function getLinkedScenario() {
  const params = new URLSearchParams(window.location.search);
  return resolveScenario(params.get('scenario'));
}

export class ScenarioPanel {
  constructor(engine) {
    this.engine = engine;
    this.selectEl = document.getElementById('scenario-select');
    this.summaryEl = document.getElementById('scenario-summary');
    this.nameEl = document.getElementById('scenario-name');
    this.startBtn = document.getElementById('btn-start-scenario');
  }

  init() {
    for (const [key, scenario] of Object.entries(SCENARIOS)) {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = scenario.name;
      option.selected = scenario === this.engine.scenario;
      this.selectEl.append(option);
    }

    this.selectEl.addEventListener('change', () => {
      this.showSummary(SCENARIOS[this.selectEl.value]);
      this.selectEl.blur();
    });

    this.startBtn.addEventListener('click', () => {
      this.start(SCENARIOS[this.selectEl.value]);
      this.startBtn.blur();
    });

    this.showSummary(this.engine.scenario);
    this.showName(this.engine.scenario);
  }

  start(scenario) {
    this.engine.loadScenario(scenario);
    this.showName(scenario);
  }

  showSummary(scenario) {
    this.summaryEl.replaceChildren(
      ...describeScenario(scenario).map(({ label, value }) => {
        const item = document.createElement('div');
        const term = document.createElement('dt');
        const detail = document.createElement('dd');
        term.textContent = label;
        detail.textContent = value;
        item.append(term, detail);
        return item;
      })
    );
  }

  showName(scenario) {
    this.nameEl.innerHTML = `Now playing: <strong>${scenario.name}</strong>`;
  }
}
