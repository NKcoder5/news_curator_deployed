import { Link } from 'react-router-dom';
import {
  ArrowRight, Columns2, History, Languages, LayoutDashboard, Library, Newspaper, Scale, Search, ShieldCheck
} from 'lucide-react';
import { Button, VerdictBadge, VERDICTS } from '../components/ui';
import useDocumentTitle from '../hooks/useDocumentTitle';
import '../styles/LandingPage.css';

/**
 * The front door. It used to sell "Smart News Analysis" with a rotating 3-D
 * carousel (its cards mirrored as they turned) and emoji feature tiles, and
 * three of its sections only appeared after a scroll animation — so a
 * reviewer who did not scroll saw empty bands. Now it says what the product
 * does, shows a real result, and states the measured record.
 */

// Measured on the labelled test sets (backend/eval), 12 Oct 2026.
const RECORD = [
  { figure: '21 / 22', label: 'benchmark claims answered correctly, none wrong' },
  { figure: '0', label: 'verdicts in the wrong direction across every test set' },
  { figure: '24 / 27', label: 'held-out claims, never used to tune the rules' },
  { figure: '13 / 22', label: 'for a plain AI model on the same benchmark — 5 of them wrong' }
];

const STEPS = [
  { icon: Languages, title: 'Read the message', text: 'Works out the language — English, Tamil, Hindi or Tanglish — whether it states, asks or merely passes something on, and the claims inside it.' },
  { icon: Search, title: 'Gather the evidence', text: 'Searches independent outlets, fact-checkers’ rulings, this week’s coverage of the subject and reference facts, all at once.' },
  { icon: Scale, title: 'Decide by rule', text: 'Fixed, ordered rules turn the evidence into a verdict, and say which rule decided and how often that rule has been right.' },
  { icon: History, title: 'Remember the claim', text: 'Every check is kept. A claim that comes back reworded, translated or with a figure changed is recognised; unsettled ones are checked again.' }
];

const FEATURES = [
  { icon: ShieldCheck, title: 'Check anything', text: 'A forwarded message, a link, a YouTube video or a screenshot.', to: '/check' },
  { icon: Library, title: 'Claims database', text: 'Every claim checked so far, searchable, each with a permanent page and its history.', to: '/claims' },
  { icon: Newspaper, title: 'A news feed with verdicts', text: 'Today’s stories, each marked with what the checks found about its publisher and claims.', to: '/home?category=general' },
  { icon: Columns2, title: 'Compare coverage', text: 'One story as several outlets told it: what they agree on and where they differ.', to: '/compare' },
  { icon: LayoutDashboard, title: 'Your dashboard', text: 'What you have read and what the checks concluded about it.', to: '/dashboard' }
];

/** A real result (live check, 12 Oct 2026), drawn with the same parts as the Check page. */
const SampleResult = () => (
  <figure className="landing-sample" aria-label="An example result">
    <figcaption className="landing-sample__caption">Example result</figcaption>
    <div className="landing-sample__card">
      <p className="landing-sample__label">Claim checked</p>
      <p className="landing-sample__claim">“India won 90 medals at the Asian Games 2026.”</p>
      <div className="landing-sample__verdict">
        <VerdictBadge call="FAKE" size="md" />
        <p>4 independent outlets report otherwise: <strong>85 medals</strong>.</p>
      </div>
      <ul className="landing-sample__sources">
        <li><span className="landing-sample__tag">Says otherwise</span> The Indian Express · <em>“complete list of all 85 medals”</em></li>
        <li><span className="landing-sample__tag">Says otherwise</span> News On AIR · <em>“India finishes 4th with 85 medals”</em></li>
        <li><span className="landing-sample__tag">Says otherwise</span> DD India · <em>“India’s 85-medal campaign”</em></li>
      </ul>
      <p className="landing-sample__meta">
        Decided by: <strong>Independent outlets report otherwise</strong> · right in 22 of 22 test messages
      </p>
    </div>
  </figure>
);

const LandingPage = ({ signedIn = false }) => {
  useDocumentTitle();
  const start = signedIn ? '/check' : '/signup';

  return (
    <div className="landing">
      <section className="landing-hero">
        <div className="landing-hero__inner">
          <div className="landing-hero__text">
            <p className="landing-eyebrow">Evidence-based fact checking for news and forwards</p>
            <h1 className="landing-title">Know whether it is true before you share it.</h1>
            <p className="landing-lead">
              Paste a WhatsApp forward, a link or a screenshot. Pure Press finds the claims in it, checks them against
              independent outlets, fact-checkers and reference facts, and gives you a verdict you can trace to its sources.
            </p>
            <div className="landing-actions">
              <Button as={Link} to={start} size="lg" iconRight={ArrowRight}>{signedIn ? 'Check a message' : 'Start checking — it’s free'}</Button>
              <Button as={Link} to="/claims" size="lg" variant="secondary" icon={Library}>Browse checked claims</Button>
            </div>
            <p className="landing-languages">
              Reads <span lang="en">English</span>, <span lang="ta">தமிழ்</span>, <span lang="hi">हिन्दी</span> and Tanglish.
              No payment details, ever.
            </p>
          </div>
          <SampleResult />
        </div>
      </section>

      <section className="landing-record" aria-labelledby="record-title">
        <div className="landing-section__inner">
          <h2 id="record-title" className="landing-record__title">A measured record, not a promise</h2>
          <dl className="landing-record__grid">
            {RECORD.map((r) => (
              <div key={r.label} className="landing-stat">
                <dt className="landing-stat__figure tabular">{r.figure}</dt>
                <dd className="landing-stat__label">{r.label}</dd>
              </div>
            ))}
          </dl>
          <p className="landing-record__note">Counted on labelled test messages, 12 October 2026. Every verdict shows its rule’s own record.</p>
        </div>
      </section>

      <section className="landing-section" aria-labelledby="how-title" id="how-it-works">
        <div className="landing-section__inner">
          <div className="landing-section__head">
            <p className="landing-eyebrow">How it works</p>
            <h2 id="how-title" className="landing-section__title">Evidence first, then a verdict — never the other way round</h2>
          </div>
          <ol className="landing-steps">
            {STEPS.map(({ icon: Icon, title, text }, i) => (
              <li key={title} className="landing-step">
                <span className="landing-step__icon" aria-hidden="true"><Icon size={20} /></span>
                <span className="landing-step__number">Step {i + 1}</span>
                <h3 className="landing-step__title">{title}</h3>
                <p className="landing-step__text">{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="landing-section landing-section--sunken" aria-labelledby="verdicts-title">
        <div className="landing-section__inner">
          <div className="landing-section__head">
            <p className="landing-eyebrow">Plain answers</p>
            <h2 id="verdicts-title" className="landing-section__title">Four verdicts, each with its reason</h2>
            <p className="landing-section__lead">
              And no verdict at all for a question, an opinion or something too vague to place — only a note saying
              what would make it checkable.
            </p>
          </div>
          <dl className="landing-verdicts">
            {['REAL', 'FAKE', 'PARTLY FALSE', 'CANNOT VERIFY'].map((call) => (
              <div key={call} className="landing-verdict">
                <dt><VerdictBadge call={call} label={VERDICTS[call].label} /></dt>
                <dd>{VERDICTS[call].description}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="landing-section" aria-labelledby="features-title">
        <div className="landing-section__inner">
          <div className="landing-section__head">
            <p className="landing-eyebrow">Everything in one place</p>
            <h2 id="features-title" className="landing-section__title">Built around the check</h2>
          </div>
          <ul className="landing-features">
            {FEATURES.map(({ icon: Icon, title, text, to }) => (
              <li key={title} className="landing-feature">
                <span className="landing-feature__icon" aria-hidden="true"><Icon size={20} /></span>
                <h3 className="landing-feature__title">
                  <Link to={to} className="landing-feature__link">{title}</Link>
                </h3>
                <p className="landing-feature__text">{text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="landing-cta">
        <div className="landing-section__inner landing-cta__inner">
          <div>
            <h2 className="landing-cta__title">Got a forward you are not sure about?</h2>
            <p className="landing-cta__text">Check it now — the answer and its sources in about twenty seconds.</p>
          </div>
          <div className="landing-actions">
            <Button as={Link} to={start} size="lg" iconRight={ArrowRight}>{signedIn ? 'Check a message' : 'Create a free account'}</Button>
            {!signedIn && <Button as={Link} to="/login" size="lg" variant="secondary">Sign in</Button>}
          </div>
        </div>
      </section>
    </div>
  );
};

export default LandingPage;
