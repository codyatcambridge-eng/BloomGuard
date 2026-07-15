import { useCallback, useState } from 'react';
import { Coffee } from 'lucide-react';
import { useUtilityPass } from '@/hooks/useUtilityPass';
import { UtilityPassModal } from '@/components/utility-pass';
import { DEFAULT_USER_PROGRESS } from '@/models/UserProgress';
import { UtilityPassReason, UtilityPassDuration } from '@/logic/utilityPass';

const HomeDashboard = () => {
  const { isActive, remainingFormatted, startPass, endPassEarly } = useUtilityPass();
  const [showUtilityPassModal, setShowUtilityPassModal] = useState(false);

  const handleUtilityPassComplete = useCallback((reason: UtilityPassReason, duration: UtilityPassDuration, gateLevel: number) => {
    startPass(reason, duration, gateLevel);
    setShowUtilityPassModal(false);
  }, [startPass]);

  return (
    <div className="min-h-screen pb-24 warroom-bg relative overflow-hidden flex items-center justify-center">
      <main className="relative z-10 w-full max-w-md px-5">
        <header className="text-center mb-8">
          <h1 className="font-display text-3xl tracking-wider text-gold">Bloom Guard</h1>
          <p className="text-[10px] text-gold/50 tracking-[0.3em] uppercase mt-0.5">Miracle Worker</p>
          <p className="mt-2 text-silver">Welcome back!</p>
          <p className="mt-1 text-aqua font-display tracking-wide">Hopee</p>
          <p className="mt-1 text-aqua font-display tracking-wide">science</p>
          <p className="mt-1 text-aqua font-display tracking-wide">trust</p>
          <p className="mt-1 text-aqua font-display tracking-wide">JIM</p>
          <p className="mt-1 text-aqua font-display tracking-wide">boyii</p>
          <p className="mt-1 text-aqua font-display tracking-wide">Iphone7</p>
          <p className="mt-1 text-aqua font-display tracking-wide">Lemon</p>
          <p className="mt-1 text-aqua font-display tracking-wide">pink</p>
          <p className="mt-1 text-aqua font-display tracking-wide">Wobble</p>
          <p className="mt-1 text-aqua font-display tracking-wide">good</p>
          <p className="mt-1 text-aqua font-display tracking-wide">changes</p>
          <p className="mt-1 text-aqua font-display tracking-wide">dialfix</p>
          <p className="mt-1 text-aqua font-display tracking-wide">Jice</p>
          <p className="mt-1 text-aqua font-display tracking-wide">dial2</p>
          <p className="mt-1 text-aqua font-display tracking-wide">pairfix</p>
          <p className="mt-1 text-aqua font-display tracking-wide">exitfix</p>
          <p className="mt-1 text-aqua font-display tracking-wide">pair2</p>
          <p className="mt-1 text-aqua font-display tracking-wide">accfix</p>
          <p className="mt-1 text-aqua font-display tracking-wide">mvpnear</p>
          <p className="mt-1 text-aqua font-display tracking-wide">coldfix</p>
          <p className="mt-1 text-aqua font-display tracking-wide">exitheal</p>
          <p className="mt-1 text-aqua font-display tracking-wide">life1</p>
          <p className="mt-1 text-aqua font-display tracking-wide">life2</p>
          <p className="mt-1 text-aqua font-display tracking-wide">sframe</p>
          <p className="mt-1 text-aqua font-display tracking-wide">rev1</p>
          <p className="mt-1 text-aqua font-display tracking-wide">acc2</p>
          <p className="mt-1 text-aqua font-display tracking-wide">watch1</p>
          <p className="mt-1 text-aqua font-display tracking-wide">Jesus</p>
          <p className="mt-1 text-aqua font-display tracking-wide">sacc</p>
          <p className="mt-1 text-aqua font-display tracking-wide">sacc2</p>
          <p className="mt-1 text-aqua font-display tracking-wide">sacc3</p>
          <p className="mt-1 text-aqua font-display tracking-wide">exitsoft</p>
          <p className="mt-1 text-aqua font-display tracking-wide">MVPCANDIATE11</p>
          <p className="mt-1 text-aqua font-display tracking-wide">orphanfix</p>
          <p className="mt-1 text-aqua font-display tracking-wide">partial2</p>
          {isActive && (
            <p className="mt-2 text-xs text-silver/70">
              Break active: {remainingFormatted}
              <button
                onClick={endPassEarly}
                className="ml-2 underline text-silver hover:text-foreground"
              >
                End early
              </button>
            </p>
          )}
        </header>

        <button
          onClick={() => setShowUtilityPassModal(true)}
          disabled={isActive}
          className={`w-full py-4 px-4 rounded-xl border transition-all duration-200 flex items-center justify-center gap-3 ${
            isActive
              ? 'border-silver/20 bg-cathedral-deep/30 text-silver/50 cursor-not-allowed'
              : 'border-silver/30 bg-cathedral-deep/50 text-silver hover:border-techBlue/50 hover:text-techBlue'
          }`}
        >
          <Coffee className="w-4 h-4" />
          <span className="font-display text-sm tracking-wider">
            {isActive ? 'Break in progress...' : 'Need a break?'}
          </span>
        </button>
      </main>

      <UtilityPassModal
        isOpen={showUtilityPassModal}
        onClose={() => setShowUtilityPassModal(false)}
        onComplete={handleUtilityPassComplete}
        onResisted={undefined}
        progress={DEFAULT_USER_PROGRESS}
      />
    </div>
  );
};

export default HomeDashboard;
