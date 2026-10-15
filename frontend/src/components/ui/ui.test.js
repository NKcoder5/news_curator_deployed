import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Alert, Button, EmptyState, Field, TabPanel, Tabs, ThemeToggle, VerdictBadge, verdictFor } from '.';
import { readStoredTheme, storeTheme, THEME_KEY } from '../../services/theme';

describe('VerdictBadge', () => {
  // A verdict must never be carried by colour alone: the word is always
  // there, and each call gets its own tone (and with it its own icon).
  test.each([
    ['REAL', 'real'],
    ['FAKE', 'fake'],
    ['PARTLY FALSE', 'partly'],
    ['MISLEADING', 'misleading'],
    ['CANNOT VERIFY', 'unknown'],
    ['SATIRE', 'info']
  ])('%s is shown in words with the %s tone and an icon', (call, tone) => {
    const { container } = render(<VerdictBadge call={call} />);
    // CANNOT VERIFY is shown to readers as UNPROVEN; every other call as it is.
    expect(screen.getByText(call === 'CANNOT VERIFY' ? 'UNPROVEN' : call)).toBeInTheDocument();
    expect(container.firstChild).toHaveAttribute('data-verdict', tone);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  test('a call it does not know is shown as it came, in the neutral tone', () => {
    const { container } = render(<VerdictBadge call="SOMETHING NEW" />);
    expect(screen.getByText('SOMETHING NEW')).toBeInTheDocument();
    expect(container.firstChild).toHaveAttribute('data-verdict', 'unknown');
  });

  test('calls are matched regardless of case and spacing', () => {
    expect(verdictFor(' cannot  verify ').tone).toBe('unknown');
    expect(verdictFor('partly false').tone).toBe('partly');
  });

  test('a legend can name the verdict in its own words', () => {
    render(<VerdictBadge call="FAKE" label="Fake" />);
    expect(screen.getByText('Fake')).toBeInTheDocument();
    expect(screen.queryByText('FAKE')).not.toBeInTheDocument();
  });
});

describe('Button', () => {
  test('defaults to type="button" so it never submits a form by accident', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button');
  });

  test('while loading it is disabled and says it is busy', () => {
    const onClick = jest.fn();
    render(<Button loading onClick={onClick}>Checking…</Button>);
    const button = screen.getByRole('button', { name: /checking/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  test('can render as a link', () => {
    render(<Button as="a" href="/check">Start checking</Button>);
    expect(screen.getByRole('link', { name: 'Start checking' })).toHaveAttribute('href', '/check');
  });
});

describe('Tabs', () => {
  const TABS = [{ id: 'text', label: 'Paste text' }, { id: 'link', label: 'Paste a link' }, { id: 'image', label: 'Upload a screenshot' }];
  const Harness = () => {
    const [value, setValue] = useState('text');
    return (
      <>
        <Tabs tabs={TABS} value={value} onChange={setValue} label="Input" idPrefix="t" />
        <TabPanel id={value} idPrefix="t">Panel for {value}</TabPanel>
      </>
    );
  };

  test('one tab stop; the selected tab controls the visible panel', () => {
    render(<Harness />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', tabs[0].id);
    expect(tabs[0]).toHaveAttribute('aria-controls', screen.getByRole('tabpanel').id);
  });

  test('arrow keys, Home and End move the selection and the focus', () => {
    render(<Harness />);
    const first = screen.getByRole('tab', { name: 'Paste text' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Paste a link' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Paste a link' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement, { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Upload a screenshot' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(document.activeElement, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Paste text' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(document.activeElement, { key: 'ArrowLeft' });
    expect(screen.getByText('Panel for image')).toBeInTheDocument();
  });
});

describe('Alert and EmptyState', () => {
  test('a failure interrupts; a note waits its turn', () => {
    const { rerender } = render(<Alert tone="danger">It failed.</Alert>);
    expect(screen.getByRole('alert')).toHaveTextContent('It failed.');
    rerender(<Alert tone="info">Just so you know.</Alert>);
    expect(screen.getByRole('status')).toHaveTextContent('Just so you know.');
  });

  test('a dismissible alert can be dismissed', () => {
    const onDismiss = jest.fn();
    render(<Alert tone="warning" onDismiss={onDismiss}>Careful.</Alert>);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalled();
  });

  test('an empty state says what is missing and offers the way to fill it', () => {
    render(<EmptyState title="Nothing read yet" description="Open a story to start." action={<Button>Browse news</Button>} />);
    expect(screen.getByRole('heading', { name: 'Nothing read yet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Browse news' })).toBeInTheDocument();
  });
});

describe('Field', () => {
  test('wires the label, hint and error to the control', () => {
    render(<Field label="Email" hint="We never share it." error="Enter an email address."><input className="ui-input" /></Field>);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('We never share it. Enter an email address.');
  });
});

describe('Theme', () => {
  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    jest.restoreAllMocks();
  });

  test('the toggle switches the theme and remembers the choice', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: /switch to dark theme/i }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(window.localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(screen.getByRole('button', { name: /switch to light theme/i })).toBeInTheDocument();
  });

  // Private windows and blocked site data make storage throw. A theme is
  // never worth a broken page.
  test('storage that throws is survived, and the theme still applies', () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => storeTheme('dark')).not.toThrow();
    expect(readStoredTheme()).toBeNull();
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: /switch to dark theme/i }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });

  test('a stored value that is not a theme is ignored', () => {
    window.localStorage.setItem(THEME_KEY, 'purple');
    expect(readStoredTheme()).toBeNull();
  });
});
