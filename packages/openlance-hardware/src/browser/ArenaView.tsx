// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance

/** Top-down drawing of the arena: walls, goal, the path so far and the robot. */

import * as React from 'react';
import { DEFAULT_ROBOT, type ArenaEvent, type ArenaSpec, type RobotPose } from 'robolance-hardware-sim';

export interface ArenaViewProps {
    spec: ArenaSpec;
    /** The poses recorded so far, oldest first; the last one is where the robot is. */
    path: RobotPose[];
    events?: ArenaEvent[];
    /** Distance the sensor sees ahead, cm, when known. */
    distanceAheadCm?: number;
    robotRadius?: number;
    reachedGoal?: boolean;
    /** Extra drawing in arena coordinates (the editor's handles). */
    children?: React.ReactNode;
    /** Handlers and attributes for the SVG element itself (the editor's pointer events). */
    svgProps?: React.SVGProps<SVGSVGElement>;
    svgRef?: React.Ref<SVGSVGElement>;
}

export function ArenaView({ spec, path, events = [], distanceAheadCm, robotRadius = DEFAULT_ROBOT.radius, reachedGoal = false, children, svgProps, svgRef }: ArenaViewProps): React.ReactElement {
    const pose = path[path.length - 1] ?? spec.start;
    const heading = (pose.headingDeg * Math.PI) / 180;
    const dx = Math.cos(heading);
    const dy = -Math.sin(heading);
    const points = path.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const ray = distanceAheadCm !== undefined ? Math.min(distanceAheadCm, 400) : undefined;
    return (
        <svg
            className="robolance-arena"
            width={spec.width + 8}
            height={spec.height + 8}
            viewBox={`-4 -4 ${spec.width + 8} ${spec.height + 8}`}
            role="img"
            aria-label={`Arena ${spec.width} by ${spec.height} centimetres`}
            ref={svgRef}
            {...svgProps}
        >
            <rect x={0} y={0} width={spec.width} height={spec.height} className="robolance-arena-floor" />
            {spec.walls.map((w, i) => (
                <line key={i} x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} className="robolance-arena-wall" />
            ))}
            <circle cx={spec.goal.x} cy={spec.goal.y} r={spec.goal.radius} className={`robolance-arena-goal${reachedGoal ? ' reached' : ''}`} />
            <text x={spec.goal.x} y={spec.goal.y + 1.5} className="robolance-arena-text" textAnchor="middle">goal</text>
            <circle cx={spec.start.x} cy={spec.start.y} r={2} className="robolance-arena-start" />
            {points && <polyline points={points} className="robolance-arena-path" />}
            {events.filter(e => e.kind === 'collision').map((e, i) => (
                <g key={i} className="robolance-arena-collision" transform={`translate(${e.pose.x} ${e.pose.y})`}>
                    <line x1={-2.5} y1={-2.5} x2={2.5} y2={2.5} />
                    <line x1={-2.5} y1={2.5} x2={2.5} y2={-2.5} />
                </g>
            ))}
            {ray !== undefined && (
                <line
                    x1={pose.x + dx * robotRadius}
                    y1={pose.y + dy * robotRadius}
                    x2={pose.x + dx * (robotRadius + ray)}
                    y2={pose.y + dy * (robotRadius + ray)}
                    className="robolance-arena-ray"
                />
            )}
            <g transform={`translate(${pose.x} ${pose.y})`}>
                <circle r={robotRadius} className="robolance-arena-robot" />
                <line x1={0} y1={0} x2={dx * robotRadius} y2={dy * robotRadius} className="robolance-arena-heading" />
            </g>
            {children}
        </svg>
    );
}
