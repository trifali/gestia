import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, getCalendarBusySlots } from 'wasp/client/operations';

// ─── Utilities ────────────────────────────────────────────────────────────────
function toDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addMins(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const t = h * 60 + m + minutes;
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

type BusySlot = { start: string; end: string };

/** True if the 30-min window starting at `time` overlaps any busy slot */
function slotOccupied(time: string, date: string, busy: BusySlot[]): boolean {
  const s = new Date(`${date}T${time}:00`);
  const e = new Date(s.getTime() + 30 * 60_000);
  return busy.some((b) => s < new Date(b.end) && e > new Date(b.start));
}

/** True if a meeting of `dur` minutes can start at `time` without overlapping busy slots */
function slotStartable(time: string, date: string, busy: BusySlot[], dur: number): boolean {
  const s = new Date(`${date}T${time}:00`);
  const e = new Date(s.getTime() + dur * 60_000);
  return !busy.some((b) => s < new Date(b.end) && e > new Date(b.start));
}

// 7:00 – 19:30 in 30-min steps
const TIME_SLOTS: string[] = [];
for (let h = 7; h < 20; h++) {
  TIME_SLOTS.push(`${String(h).padStart(2, '0')}:00`);
  TIME_SLOTS.push(`${String(h).padStart(2, '0')}:30`);
}

// ─── Mini month calendar ──────────────────────────────────────────────────────
function MiniCalendar({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (d: string) => void;
}) {
  const today = useMemo(toDateStr, []);
  const [view, setView] = useState(() => {
    const d = new Date((selected || today) + 'T12:00:00');
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const yr = view.getFullYear();
  const mo = view.getMonth();
  const MONTHS = [
    'Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin',
    'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc',
  ];
  const DAYS = ['Di', 'Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa'];

  const startDay = new Date(yr, mo, 1).getDay();
  const numDays  = new Date(yr, mo + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(startDay).fill(null),
    ...Array.from({ length: numDays }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const fmt = (day: number) =>
    `${yr}-${String(mo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  return (
    <div className='select-none'>
      {/* Month nav */}
      <div className='flex items-center justify-between mb-2'>
        <button
          type='button'
          onClick={() => setView(new Date(yr, mo - 1, 1))}
          className='w-6 h-6 flex items-center justify-center rounded hover:bg-canvas-200 text-muted font-bold text-sm transition-colors'
        >‹</button>
        <span className='text-xs font-semibold'>{MONTHS[mo]} {yr}</span>
        <button
          type='button'
          onClick={() => setView(new Date(yr, mo + 1, 1))}
          className='w-6 h-6 flex items-center justify-center rounded hover:bg-canvas-200 text-muted font-bold text-sm transition-colors'
        >›</button>
      </div>

      {/* Day headers */}
      <div className='grid grid-cols-7 mb-0.5'>
        {DAYS.map((d) => (
          <div key={d} className='text-center text-[10px] text-muted font-medium py-0.5'>{d}</div>
        ))}
      </div>

      {/* Day cells */}
      <div className='grid grid-cols-7 gap-y-0.5'>
        {cells.map((day, i) => {
          if (!day) return <div key={`_${i}`} />;
          const ds = fmt(day);
          const isSel  = ds === selected;
          const isToday = ds === today;
          const past    = ds < today;
          return (
            <button
              key={ds}
              type='button'
              disabled={past}
              onClick={() => onSelect(ds)}
              className={[
                'text-[11px] py-1 rounded transition-colors mx-px',
                isSel    ? 'bg-accent text-white font-semibold' : '',
                isToday && !isSel ? 'font-bold text-accent' : '',
                past && !isSel ? 'text-muted/25 cursor-not-allowed' : '',
                past &&  isSel ? 'opacity-60 cursor-not-allowed' : '',
                !past && !isSel ? 'hover:bg-canvas-100' : '',
              ].filter(Boolean).join(' ')}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── DayTimePicker ────────────────────────────────────────────────────────────
type Props = {
  /** YYYY-MM-DDTHH:MM */
  value: string;
  onChange: (v: string) => void;
  /** Meeting duration in minutes (30 or 60) */
  duration: number;
  onDurationChange: (d: number) => void;
};

export function DayTimePicker({ value, onChange, duration, onDurationChange }: Props) {
  const today = useMemo(toDateStr, []);

  const [selectedDate, setSelectedDate] = useState<string>(() =>
    value?.includes('T') ? value.split('T')[0] : today,
  );

  const selectedTime = useMemo<string | null>(() => {
    if (!value?.includes('T')) return null;
    const [d, t] = value.split('T');
    return d === selectedDate ? (t?.slice(0, 5) ?? null) : null;
  }, [value, selectedDate]);

  const { data: busyData, isLoading: busyLoading } = useQuery(
    getCalendarBusySlots,
    { date: selectedDate },
  );
  const busy: BusySlot[] = (busyData as any)?.busy ?? [];

  // Track whether this is the very first busy-data load so we don't
  // accidentally clear a pre-selected time when editing an existing meeting
  // (the meeting's own slot shows up as "busy" in the calendar).
  const userSelectedTimeRef = useRef(false);

  // Clear the selected time if busy data has loaded and the current slot is unavailable.
  // Only applies to times the user explicitly clicked — never to pre-loaded times (edit mode).
  useEffect(() => {
    if (!userSelectedTimeRef.current) return;
    if (!busyLoading && selectedTime && !slotStartable(selectedTime, selectedDate, busy, duration)) {
      onChange(selectedDate); // date only, no time
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busyLoading, selectedDate]);

  // Auto-scroll to 9:00 whenever the date changes
  const timelineRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (timelineRef.current) {
      // 9:00 = 4th slot (0-indexed), each slot ≈ 29px
      timelineRef.current.scrollTop = 4 * 29;
    }
  }, [selectedDate]);

  const onDateSelect = (d: string) => {
    setSelectedDate(d);
    // Changing the date resets the "user explicitly picked a time" flag so
    // the auto-clear won't fire until they actively choose a slot on the new day.
    userSelectedTimeRef.current = false;
    onChange(d);
  };

  const displayDate = useMemo(() => {
    try {
      return new Date(selectedDate + 'T12:00:00').toLocaleDateString('fr-CA', {
        weekday: 'long', day: 'numeric', month: 'long',
      });
    } catch { return selectedDate; }
  }, [selectedDate]);

  return (
    <div className='rounded-xl border border-canvas-300 overflow-hidden shadow-sm bg-white'>
      {/* Duration toggle */}
      <div className='flex items-center gap-2 px-3 py-2 border-b border-canvas-300 bg-canvas-50'>
        <span className='text-xs text-muted font-medium shrink-0'>Durée :</span>
        {[30, 60].map((d) => (
          <button
            key={d}
            type='button'
            onClick={() => onDurationChange(d)}
            className={[
              'px-3 py-0.5 rounded-full text-xs font-medium transition-colors',
              duration === d
                ? 'bg-accent text-white'
                : 'bg-canvas-200 hover:bg-canvas-300 text-foreground',
            ].join(' ')}
          >
            {d === 30 ? '30 min' : '1 heure'}
          </button>
        ))}
      </div>

      <div className='flex'>
        {/* Left: mini calendar */}
        <div className='p-3 shrink-0 w-44 border-r border-canvas-300'>
          <MiniCalendar selected={selectedDate} onSelect={onDateSelect} />
        </div>

        {/* Right: time slots */}
        <div className='flex flex-col flex-1 min-w-0'>
          {/* Date header */}
          <div className='px-3 pt-2 pb-1.5 border-b border-canvas-200'>
            <p className='text-[11px] font-semibold capitalize'>{displayDate}</p>
            <p className='text-[10px] text-muted mt-0.5'>
              {busyLoading
                ? '…chargement des disponibilités'
                : busy.length === 0
                  ? 'Journée disponible'
                  : `${busy.length} créneau${busy.length > 1 ? 'x' : ''} occupé${busy.length > 1 ? 's' : ''}`}
            </p>
          </div>

          {/* Scrollable slots */}
          <div ref={timelineRef} className='overflow-y-auto' style={{ maxHeight: 240 }}>
            {busyLoading ? (
              <div className='p-4 text-xs text-muted text-center'>Chargement…</div>
            ) : (
              <div className='py-1'>
                {TIME_SLOTS.map((time) => {
                  const occupied  = slotOccupied(time, selectedDate, busy);
                  const startable = !occupied && slotStartable(time, selectedDate, busy, duration);
                  const selMins   = selectedTime ? toMinutes(selectedTime) : -1;
                  const slotMins  = toMinutes(time);
                  const inSel     = selMins >= 0 && slotMins >= selMins && slotMins < selMins + duration;
                  const isStart   = inSel && slotMins === selMins;
                  const isEnd     = inSel && slotMins === selMins + duration - 30;

                  return (
                    <button
                      key={time}
                      type='button'
                      disabled={!startable && !inSel}
                      onClick={() => { if (startable) { userSelectedTimeRef.current = true; onChange(`${selectedDate}T${time}`); } }}
                      className={[
                        'w-full flex items-center gap-2 px-3 py-[5px] text-left transition-colors',
                        inSel   ? 'bg-accent text-white' : '',
                        occupied ? 'cursor-default' : '',
                        !occupied && !inSel ? 'hover:bg-canvas-50 cursor-pointer' : '',
                      ].filter(Boolean).join(' ')}
                    >
                      {/* Time label */}
                      <span className={`text-[11px] w-8 shrink-0 tabular-nums font-mono ${inSel ? 'text-white/70' : 'text-muted'}`}>
                        {time}
                      </span>

                      {/* Slot content */}
                      {occupied ? (
                        <div className='flex items-center gap-1.5'>
                          <div className='h-3 w-0.5 rounded-full bg-red-400/70 shrink-0' />
                          <span className='text-[11px] text-muted/50 italic'>Occupé</span>
                        </div>
                      ) : isStart ? (
                        <span className='text-xs font-semibold'>
                          {time} – {addMins(time, duration)}
                          <span className='opacity-70 ml-1.5'>✓</span>
                        </span>
                      ) : isEnd ? (
                        <span className='text-[11px] opacity-60'>{addMins(time, 30)}</span>
                      ) : inSel ? (
                        <div className='flex-1 h-px bg-white/25' />
                      ) : (
                        <div className='flex-1 h-px bg-canvas-200' />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
