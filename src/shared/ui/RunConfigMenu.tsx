import { colors } from '@lody/ui/tokens/colors.stylex';
import { space } from '@lody/ui/tokens/scales.stylex';
import * as stylex from '@stylexjs/stylex';
import type { MouseEvent, ReactNode } from 'react';
import { useMemo, useState } from 'react';

import { popup } from '../../../vendor/lody/packages/ui/src/popup/popup.tokens.stylex';
import { Icon } from '../icons/Icon';
import { composerSurface as surface } from './composer';
import { Menu, Switch } from './index';
import { fuzzyMatch } from './menu';
import { MenuSearchInput } from './MenuSearchInput';
import { SearchableMenuContent } from './SearchableMenuContent';

const queryTerms = /\s+/;
const rootMenuTheme = stylex.createTheme(popup, { menuWidth: '240px' });
const optionMenuTheme = stylex.createTheme(popup, { menuWidth: '108px' });

// Product UI copied from Lody's desktop-run-config-menu.tsx; desktop stores are controlled props here.
const styles = stylex.create({
  rowValue: {
    display: 'flex',
    alignItems: 'center',
    gap: space[1.5],
    flexShrink: 1,
    minWidth: 0,
    maxWidth: '10rem',
    marginInlineStart: 'auto',
    paddingInlineStart: space[4],
    color: colors.label,
    fontWeight: 400,
  },
  modelName: { maxWidth: '10rem', direction: 'rtl' },
  optionMenu: { width: 'max-content', minWidth: 108, maxWidth: 320, overflowY: 'hidden' },
  modelList: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    maxHeight: 'min(20rem, var(--available-height, 20rem))',
  },
  searchBody: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    minHeight: 0,
    minWidth: 224,
  },
  options: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    minHeight: 0,
    overflowX: 'hidden',
    overflowY: 'auto',
    scrollbarGutter: 'auto',
  },
  switch: { pointerEvents: 'none', flexShrink: 0 },
});

interface RunOption {
  value: string;
  label: string;
  disabled?: boolean;
}
export interface RunConfigMenuProps {
  disabled: boolean;
  agentLocked: boolean;
  agentLabel: string;
  models: readonly RunOption[];
  modelId: string;
  onModelChange: (value: string) => void;
  reasoningOptions: readonly RunOption[];
  reasoningEffort: string;
  onReasoningChange: (value: string) => void;
  planMode?: boolean | undefined;
  onPlanChange: (value: boolean) => void;
  fastMode?: boolean | undefined;
  onFastChange: (value: boolean) => void;
}

function OptionItem({
  label,
  selected,
  disabled,
  onSelect,
  icon,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  icon?: ReactNode;
}) {
  return (
    <Menu.Item
      disabled={disabled}
      role="menuitemradio"
      aria-checked={selected}
      closeOnClick={false}
      onClick={onSelect}
      icon={icon}
      endContent={selected ? <Icon name="check" size={14} /> : null}
    >
      {label}
    </Menu.Item>
  );
}
function ValueSubTrigger({
  label,
  value,
  searchable = false,
}: {
  label: string;
  value?: string | undefined;
  searchable?: boolean;
}) {
  const focusOpenSearch = (event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || !window.matchMedia('(pointer: fine)').matches) return;
    const trigger = event.currentTarget;
    if (trigger.getAttribute('aria-expanded') !== 'true') return;
    const content = document.getElementById(trigger.getAttribute('aria-controls') ?? '');
    const search = content?.querySelector<HTMLInputElement>('[data-lody-menu-search]');
    if (!search || search.closest('[data-lody-menu-content]') !== content) return;
    event.preventDefault();
    search.focus({ preventScroll: true });
  };
  return (
    <Menu.SubmenuTrigger
      delay={0}
      aria-haspopup={searchable ? 'dialog' : 'menu'}
      onPointerMove={(event) => {
        if (event.pointerType === 'mouse') focusOpenSearch(event);
      }}
      onClick={focusOpenSearch}
    >
      {label}
      <span {...stylex.props(styles.rowValue)}>
        <span {...stylex.props(surface.truncate)}>{value}</span>
      </span>
    </Menu.SubmenuTrigger>
  );
}
function ToggleItem({
  label,
  checked,
  onToggle,
  icon,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  icon: ReactNode;
}) {
  return (
    <Menu.Item
      role="menuitemcheckbox"
      aria-checked={checked}
      closeOnClick={false}
      onClick={onToggle}
      icon={icon}
      endContent={
        <span inert aria-hidden="true">
          <Switch
            checked={checked}
            aria-hidden="true"
            tabIndex={-1}
            {...stylex.props(styles.switch)}
          />
        </span>
      }
    >
      {label}
    </Menu.Item>
  );
}

function ModelOptions({
  options,
  selected,
  onSelect,
}: {
  options: readonly RunOption[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const terms = query.trim().toLowerCase().split(queryTerms).filter(Boolean);
    if (!terms.length) return options;
    return options
      .flatMap((option, index) => {
        const score = (text: string) => {
          const scores = terms.map((term) => fuzzyMatch(term, text));
          return scores.includes(null)
            ? null
            : scores.reduce<number>((sum, value) => sum + (value ?? 0), 0);
        };
        const primary = score(option.label);
        const secondary = primary === null ? score(option.value) : null;
        return primary === null && secondary === null
          ? []
          : [{ option, index, tier: primary === null ? 1 : 0, score: primary ?? secondary ?? 0 }];
      })
      .sort((a, b) => a.tier - b.tier || b.score - a.score || a.index - b.index)
      .map(({ option }) => option);
  }, [options, query]);
  return (
    <div {...stylex.props(styles.searchBody)}>
      {options.length >= 6 && (
        <MenuSearchInput
          value={query}
          onValueChange={setQuery}
          onSubmit={() => {
            const top = filtered.find((option) => !option.disabled);
            if (top) onSelect(top.value);
          }}
        />
      )}
      <div
        {...stylex.props(styles.options)}
        role={filtered.length ? 'menu' : 'status'}
        aria-label="模型选项"
      >
        {filtered.length ? (
          filtered.map((option) => (
            <OptionItem
              key={option.value}
              {...option}
              selected={selected === option.value}
              onSelect={() => onSelect(option.value)}
            />
          ))
        ) : (
          <div {...stylex.props(surface.empty)}>没有匹配的模型</div>
        )}
      </div>
    </div>
  );
}

export function RunConfigMenu(props: RunConfigMenuProps) {
  const [open, setOpen] = useState(false);
  const modelLabel = props.models.find((option) => option.value === props.modelId)?.label;
  const reasoningLabel = props.reasoningOptions.find(
    (option) => option.value === props.reasoningEffort,
  )?.label;
  return (
    <Menu.Root open={open && !props.disabled} onOpenChange={setOpen}>
      <Menu.Trigger
        disabled={props.disabled}
        aria-label="运行配置"
        data-run-config-trigger=""
        render={<button type="button" aria-label="运行配置" />}
        className={(state) =>
          stylex.props(surface.trigger, surface.triggerCompact, state.open && surface.triggerOpen)
            .className ?? ''
        }
      >
        <Icon name="agent" size={16} />
        <span {...stylex.props(surface.faceText, styles.modelName)}>
          <span dir="ltr">{modelLabel}</span>
        </span>
        {reasoningLabel && (
          <>
            <span aria-hidden="true" {...stylex.props(surface.faceDot)}>
              ·
            </span>
            <span {...stylex.props(surface.faceFixed)}>{reasoningLabel}</span>
          </>
        )}
        {props.planMode && (
          <span {...stylex.props(surface.faceLive)}>
            <Icon name="plan" size={14} />
          </span>
        )}
        {props.fastMode && (
          <span {...stylex.props(surface.faceLive)}>
            <Icon name="fast" size={14} />
          </span>
        )}
      </Menu.Trigger>
      <Menu.Content
        side="top"
        align="start"
        {...stylex.props(rootMenuTheme)}
        finalFocus={() =>
          document.querySelector<HTMLTextAreaElement>('[data-keyboard-nav="composer"]')
        }
      >
        <div {...stylex.props(surface.menuList)}>
          {props.agentLocked ? (
            <Menu.Item disabled>
              Agent
              <span {...stylex.props(styles.rowValue)}>
                <Icon name="agent" size={12} />
                {props.agentLabel}
              </span>
            </Menu.Item>
          ) : (
            <Menu.Submenu>
              <ValueSubTrigger label="Agent" value={props.agentLabel} />
              <Menu.Content {...stylex.props(styles.optionMenu, optionMenuTheme)}>
                <OptionItem
                  label={props.agentLabel}
                  icon={<Icon name="agent" size={16} />}
                  selected
                  onSelect={() => {}}
                />
              </Menu.Content>
            </Menu.Submenu>
          )}
          {props.models.length > 0 && (
            <Menu.Submenu>
              <ValueSubTrigger label="模型" value={modelLabel} searchable />
              <SearchableMenuContent
                alignOffset={props.models.length >= 6 ? -32 : 0}
                {...stylex.props(styles.optionMenu, optionMenuTheme)}
              >
                <div {...stylex.props(styles.modelList)}>
                  <ModelOptions
                    options={props.models}
                    selected={props.modelId}
                    onSelect={props.onModelChange}
                  />
                </div>
              </SearchableMenuContent>
            </Menu.Submenu>
          )}
          {props.reasoningOptions.length > 0 && (
            <Menu.Submenu>
              <ValueSubTrigger label="思考强度" value={reasoningLabel} />
              <Menu.Content align="start" {...stylex.props(styles.optionMenu, optionMenuTheme)}>
                {props.reasoningOptions.map((option) => (
                  <OptionItem
                    key={option.value}
                    {...option}
                    selected={option.value === props.reasoningEffort}
                    onSelect={() => props.onReasoningChange(option.value)}
                  />
                ))}
              </Menu.Content>
            </Menu.Submenu>
          )}
          {(props.planMode !== undefined || props.fastMode !== undefined) && <Menu.Separator />}
          {props.planMode !== undefined && (
            <ToggleItem
              label="Plan"
              icon={<Icon name="plan" size={16} />}
              checked={props.planMode}
              onToggle={() => props.onPlanChange(!props.planMode)}
            />
          )}
          {props.fastMode !== undefined && (
            <ToggleItem
              label="Fast"
              icon={<Icon name="fast" size={16} />}
              checked={props.fastMode}
              onToggle={() => props.onFastChange(!props.fastMode)}
            />
          )}
        </div>
      </Menu.Content>
    </Menu.Root>
  );
}
