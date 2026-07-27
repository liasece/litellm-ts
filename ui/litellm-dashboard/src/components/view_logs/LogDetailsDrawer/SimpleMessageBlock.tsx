/**
 * SimpleMessageBlock - Simple message display without collapsing
 * Used for messages in tree view and last user message
 */

import { Typography } from 'antd';
import { MessagePart, ToolCall } from './prettyMessagesTypes';
import { SimpleToolCallBlock } from './SimpleToolCallBlock';
import { MessagePartsView } from './MessagePartsView';

const { Text } = Typography;

interface SimpleMessageBlockProps {
  label: string;
  content?: string;
  toolCalls?: ToolCall[];
  parts?: MessagePart[];
  isCompact?: boolean;
}

export function SimpleMessageBlock({ 
  label, 
  content, 
  toolCalls, 
  parts,
  isCompact = false 
}: SimpleMessageBlockProps) {
  // Don't show "null" for empty content
  const displayContent = content && content !== 'null' && content.length > 0 ? content : null;
  const hasToolCalls = toolCalls && toolCalls.length > 0;
  const hasParts = parts && parts.length > 0;

  // If no content and no tool calls, don't render
  if (!displayContent && !hasToolCalls && !hasParts) {
    return null;
  }

  return (
    <div style={{ marginBottom: isCompact ? 8 : 0 }}>
      <Text 
        type="secondary" 
        style={{ 
          fontSize: 10, 
          letterSpacing: '0.5px', 
          textTransform: 'uppercase',
          display: 'block', 
          marginBottom: 3 
        }}
      >
        {label}
      </Text>

      {hasParts ? (
        <MessagePartsView parts={parts} compact={isCompact} />
      ) : displayContent ? (
        <div
          style={{
            fontSize: 13,
            lineHeight: 1.7,
            color: '#262626',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            marginBottom: hasToolCalls ? 6 : 0,
          }}
        >
          {displayContent}
        </div>
      ) : null}

      {/* Inline tool calls for assistant messages in history */}
      {!hasParts && hasToolCalls && (
        <div>
          {toolCalls.map((tc, index) => (
            <SimpleToolCallBlock key={tc.id || index} tool={tc} compact={isCompact} />
          ))}
        </div>
      )}
    </div>
  );
}
