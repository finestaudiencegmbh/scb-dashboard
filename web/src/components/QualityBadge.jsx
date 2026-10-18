import React from 'react';

export default function QualityBadge({ quality, tiers }) {
  if (!quality) return <span className="muted">–</span>;
  const tier = tiers.find((t) => t.key === quality.tier);
  return (
    <span className="quality-badge" style={{ background: (tier?.color || '#888') + '22', color: tier?.color || '#888', borderColor: (tier?.color || '#888') + '55' }}>
      <strong>{quality.score}</strong>
      <span className="quality-tier">{quality.tier}</span>
    </span>
  );
}
