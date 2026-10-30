// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/**
 * robolance.openlance.ai/runs/: runs people published from OpenLance's
 * Hardware tab, with the Featured runs recorded with the site on top.
 * A card opens the run in the replay page.
 */

import './site.css';
import './gallery.css';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { OPENLANCE_URL as OPENLANCE, SiteHeader } from './brand';
import featuredRuns from './featured.json';
import { ago, cardHref, fetchGallery, filterCards, formatLength, mergeFeatured, PAGE_SIZE, pitchDrawing, safeAvatar, safeThumb, type GalleryCard, type GallerySort, type MissionFilter } from './gallery-data';
import mark from './openlance-mark.svg';

const FEATURED = featuredRuns as GalleryCard[];
const MISSIONS: Array<[MissionFilter, string]> = [['all', 'All'], ['goal', 'Goal'], ['obstacles', 'Obstacles'], ['laptop', 'Laptop']];

function Pitch({ card }: { card: GalleryCard }): React.ReactElement | null {
    if (!card.summary?.field || !Array.isArray(card.summary.path)) {
        return <div className="gallery-pitch gallery-pitch-empty" />;
    }
    const d = pitchDrawing(card.summary);
    return (
        <svg className="gallery-pitch" viewBox={`0 0 ${d.width} ${d.height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="The duck's walk from above">
            <rect x="0" y="0" width={d.width} height={d.height} className="gallery-turf" />
            <line x1={d.goal.x} y1={d.goal.y1} x2={d.goal.x} y2={d.goal.y2} className="gallery-goal" />
            {d.boxes.map((b, i) => (
                <rect key={i} x={b.x - b.w / 2} y={b.y - b.h / 2} width={b.w} height={b.h} rx="2"
                    transform={`rotate(${b.rotate} ${b.x} ${b.y})`} className="gallery-box" />
            ))}
            <path d={d.walk} className="gallery-walk" />
            {d.start && <circle cx={d.start[0]} cy={d.start[1]} r="4" className="gallery-start" />}
            <circle cx={d.ball[0]} cy={d.ball[1]} r="5" className="gallery-ball" />
        </svg>
    );
}

function Card({ card }: { card: GalleryCard }): React.ReactElement {
    const s = card.summary;
    const good = s ? s.outcome === 'goal' || s.outcome === 'closed' : card.score >= 80;
    const avatar = safeAvatar(card.avatar);
    const thumb = safeThumb(card.thumb);
    const length = formatLength(s?.lengthS ?? s?.seconds);
    const author = card.author || 'Anonymous';
    return (
        <a className="gallery-card" href={cardHref(card)}>
            <div className="gallery-thumb">
                {thumb
                    ? <img src={thumb} alt="" loading="lazy" width={640} height={360} />
                    : <Pitch card={card} />}
                {length && <span className="gallery-length">{length}</span>}
            </div>
            <div className="gallery-card-body">
                <span className="gallery-channel" aria-hidden="true">
                    {avatar
                        ? <img src={avatar} alt="" referrerPolicy="no-referrer" loading="lazy" width={36} height={36} />
                        : card.featured
                            ? <span className="gallery-channel-mark" dangerouslySetInnerHTML={{ __html: mark }} />
                            : <span className="gallery-channel-initial">{author.slice(0, 1).toUpperCase()}</span>}
                </span>
                <div className="gallery-card-text">
                    <h3>{card.title}</h3>
                    <div className="gallery-card-by">{author}</div>
                    <div className="gallery-card-meta">
                        {s && <span className={`gallery-outcome${good ? ' good' : ''}`}>{s.outcomeLabel}</span>}
                        <span>score {card.score}</span>
                        {!card.featured && card.publishedAt && <span>{ago(card.publishedAt)}</span>}
                    </div>
                </div>
            </div>
        </a>
    );
}

function App(): React.ReactElement {
    const [sort, setSort] = React.useState<GallerySort>('new');
    const [mission, setMission] = React.useState<MissionFilter>('all');
    const [featured, setFeatured] = React.useState<GalleryCard[]>(FEATURED);
    const [runs, setRuns] = React.useState<GalleryCard[]>([]);
    const [state, setState] = React.useState<{ kind: 'loading' | 'idle' | 'more' } | { kind: 'error'; message: string }>({ kind: 'loading' });

    const load = React.useCallback(async (offset: number) => {
        setState({ kind: offset === 0 ? 'loading' : 'more' });
        try {
            const page = await fetchGallery(sort, offset);
            if (offset === 0) {
                setFeatured(mergeFeatured(FEATURED, page.featured));
                setRuns(page.runs);
            } else {
                setRuns(prev => [...prev, ...page.runs.filter(r => !prev.some(p => p.id === r.id))]);
            }
            setState(page.runs.length === PAGE_SIZE ? { kind: 'more' } : { kind: 'idle' });
        } catch (err) {
            setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
        }
    }, [sort]);

    React.useEffect(() => { void load(0); }, [load]);

    const shownFeatured = filterCards(featured, mission);
    const shownRuns = filterCards(runs, mission);
    return (
        <>
            <SiteHeader home="../" current="runs" />
            <main className="gallery">
                <header className="gallery-header">
                    <h1>Runs people made</h1>
                    <p>
                        Each run is a robot program an AI agent wrote, ran in a physics simulator and fixed until it worked.
                        Open one to replay it in 3D. Make your own in <a href={OPENLANCE}>OpenLance</a>, then publish it from the
                        Hardware tab&apos;s Runs view.
                    </p>
                </header>

                <nav className="gallery-filters" aria-label="Missions">
                    {MISSIONS.map(([id, label]) => (
                        <button key={id} type="button" className={mission === id ? 'active' : ''} aria-pressed={mission === id} onClick={() => setMission(id)}>
                            {label}
                        </button>
                    ))}
                </nav>

                {shownFeatured.length > 0 && (
                    <section aria-labelledby="featured-heading">
                        <h2 id="featured-heading">Featured</h2>
                        <div className="gallery-grid">{shownFeatured.map(c => <Card key={c.id} card={c} />)}</div>
                    </section>
                )}

                <section aria-labelledby="runs-heading">
                    <div className="gallery-section-head">
                        <h2 id="runs-heading">From the community</h2>
                        <div className="gallery-sort" role="group" aria-label="Order">
                            <button type="button" className={sort === 'new' ? 'active' : ''} aria-pressed={sort === 'new'} onClick={() => setSort('new')}>Newest</button>
                            <button type="button" className={sort === 'best' ? 'active' : ''} aria-pressed={sort === 'best'} onClick={() => setSort('best')}>Best score</button>
                        </div>
                    </div>
                    {state.kind === 'loading' && <p className="gallery-note">Loading runs…</p>}
                    {state.kind === 'error' && <p className="gallery-note" role="alert">{state.message}</p>}
                    {state.kind !== 'loading' && state.kind !== 'error' && shownRuns.length === 0 && (
                        <p className="gallery-note">
                            No runs here yet. Be the first: in <a href={OPENLANCE}>OpenLance</a>, open a Microduck project, let the agent
                            score a goal, then Runs → Publish to gallery.
                        </p>
                    )}
                    <div className="gallery-grid">{shownRuns.map(c => <Card key={c.id} card={c} />)}</div>
                    {state.kind === 'more' && runs.length > 0 && (
                        <button type="button" className="gallery-more" onClick={() => { void load(runs.length); }}>More runs</button>
                    )}
                </section>
            </main>
        </>
    );
}

createRoot(document.getElementById('root')!).render(<App />);
