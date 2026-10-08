export function BrandLogo() {
  return (
    <span className="inline-flex items-center gap-2.5 whitespace-nowrap">
      <img
        src="/favicon.svg"
        width={72}
        height={72}
        alt=""
        className="size-9 shrink-0 object-contain"
      />
      <span className="font-display text-xl font-bold">Momentum</span>
    </span>
  );
}
