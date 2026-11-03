// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EditableRecordRow, Toggle } from '../src/commonComponents';

describe('EditableRecordRow', () => {
  const renderRow = (props: { value?: string; disabled?: boolean } = {}) => {
    const onCommit = vi.fn();
    render(
      <EditableRecordRow
        label="Title"
        value={props.value ?? 'old'}
        disabled={props.disabled}
        onCommit={onCommit}
      />
    );
    return { onCommit, user: userEvent.setup() };
  };

  it('commits the trimmed value on Enter', async () => {
    const { onCommit, user } = renderRow();
    await user.click(screen.getByRole('button', { name: 'Edit title' }));

    await user.keyboard('  new value  {Enter}');

    expect(onCommit.mock.calls).toEqual([['new value']]);
  });

  it('commits when focus leaves the field', async () => {
    const { onCommit, user } = renderRow();
    await user.click(screen.getByRole('button', { name: 'Edit title' }));

    await user.keyboard('typed');
    await user.tab();

    expect(onCommit.mock.calls).toEqual([['typed']]);
  });

  it('does not commit an unchanged value, so no needless save reaches iCloud', async () => {
    const { onCommit, user } = renderRow({ value: 'same' });
    await user.click(screen.getByRole('button', { name: 'Edit title' }));

    await user.keyboard('{Enter}');

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('abandons the edit on Escape and shows the old value', async () => {
    const { onCommit, user } = renderRow();
    await user.click(screen.getByRole('button', { name: 'Edit title' }));

    await user.keyboard('abandoned{Escape}');

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByTitle('old')).toBeTruthy();
  });

  it('offers no edit button while disabled', () => {
    renderRow({ disabled: true });
    expect(screen.queryByRole('button', { name: 'Edit title' })).toBeNull();
  });
});

describe('Toggle', () => {
  it('is a switch that reports its state and asks for the opposite one', async () => {
    const onChange = vi.fn();
    render(<Toggle aria-label="Thing" checked onChange={onChange} />);
    const toggle = screen.getByRole('switch', { name: 'Thing' });

    expect(toggle.getAttribute('aria-checked')).toBe('true');
    await userEvent.setup().click(toggle);

    expect(onChange.mock.calls).toEqual([[false]]);
  });
});
