import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';

import { Icon } from '../../shared/icons/Icon';
import { Button, Popover, Tooltip } from '../../shared/ui';
import { formatMessageTime } from '../../shared/ui/format-message-time';
import { messageSurface as styles } from '../../shared/ui/message.stylex';
import { MessageSurface } from '../../shared/ui/MessageSurface';
import type { Message } from '../connection/client';
import { reasoningLabel } from '../connection/run-config';
import { useLodyClient } from '../connection/use-client';
import { ContextStrip } from '../page-context/ContextStrip';

export function MessageView({ message }: { message: Message }) {
  const [configOpen, setConfigOpen] = useState(false);
  const client = useLodyClient();
  const config = message.inputConfig;
  const model = client.runModels.find((item) => item.value === config?.modelId);
  const mode = client.permissionModes.find((item) => item.value === config?.modeId);
  const timestamp = message.role === 'user' ? message.createdAt : message.endedAt;
  const duration =
    message.createdAt && message.endedAt
      ? `${Math.max(1, Math.round((message.endedAt - message.createdAt) / 1000))} 秒`
      : '';
  const rows = config
    ? [
        ['模型', model?.label ?? config.modelId],
        ['思考强度', reasoningLabel(config.reasoningEffort)],
        ['Plan', config.planMode ? '开启' : '关闭'],
        ['Fast', config.fastMode ? '开启' : '关闭'],
        ...(mode ? [['权限', mode.label]] : []),
      ]
    : [];
  const configuration = config ? (
    <Popover.Root open={configOpen} onOpenChange={setConfigOpen}>
      <Tooltip.Root>
        <Tooltip.Trigger
          render={
            <Popover.Trigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  icon
                  aria-label="本轮配置"
                  {...stylex.props(styles.action)}
                >
                  <Icon name="info" size={14} />
                </Button>
              }
            />
          }
        />
        {!configOpen && <Tooltip.Content>查看本轮运行配置</Tooltip.Content>}
      </Tooltip.Root>
      <Popover.Content side="bottom" align="start" sideOffset={6} {...stylex.props(styles.config)}>
        <Popover.Title {...stylex.props(styles.configHeading)}>本轮配置</Popover.Title>
        <dl {...stylex.props(styles.configList)}>
          {rows.map(([label, value]) => (
            <div key={label} {...stylex.props(styles.configRow)}>
              <dt {...stylex.props(styles.configLabel)}>{label}</dt>
              <dd {...stylex.props(styles.configValue)}>{value}</dd>
            </div>
          ))}
        </dl>
      </Popover.Content>
    </Popover.Root>
  ) : undefined;
  return (
    <MessageSurface
      role={message.role}
      text={message.text}
      status={message.status}
      timestamp={formatMessageTime(timestamp)}
      duration={duration}
      activities={message.activities}
      configuration={configuration}
      attachments={
        message.contexts.length ? <ContextStrip contexts={message.contexts} /> : undefined
      }
    />
  );
}
