import React from 'react';

export function Skeleton({ width = '100%', height = 14, radius = 8, circle = false, style }) {
  return <span className="sg-skel" aria-hidden="true" style={{ width: circle ? height : width, height, borderRadius: circle ? '50%' : radius, ...style }} />;
}

export function SkeletonText({ lines = 3, gap = 8 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }} aria-busy="true" aria-label="Đang tải">
      {Array.from({ length: lines }).map((_, i) => <Skeleton key={i} width={i === lines - 1 ? '62%' : '100%'} />)}
    </div>
  );
}
