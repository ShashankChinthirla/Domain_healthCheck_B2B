import { DomainChecker } from '@/components/DomainChecker';
import { Suspense } from 'react';

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <DomainChecker />
    </Suspense>
  );
}
