// Synthetic training scenario. No real people or incidents.
// Map coordinates are in a 1000 x 700 SVG space. North is up.

export const SCENARIO = {
  incident: {
    number: 'SAR-26-0147',
    name: 'Missing hiker, Cedar Ridge trail system',
    agency: 'Cascade County Search and Rescue (training scenario)',
    ic: 'S. Okafor',
    startedAt: '2026-09-02T14:10:00',
    now: '2026-09-02T17:40:00',
    sunset: '2026-09-02T19:32:00',
    weather: 'Overcast, 11°C, wind 20 km/h from the west, rain expected after 21:00',
    subject: {
      name: 'Subject (adult, 34)',
      profile: 'Experienced day hiker, solo, no overnight gear, light jacket, phone last pinged 13:05',
      lkp: 'Cedar Ridge trailhead, signed in 08:40',
      pls: 'Selfie posted from Pika Overlook at 12:58',
      medical: 'None reported',
    },
  },
  // Point last seen and last known point in map coordinates
  points: {
    lkp: { x: 140, y: 590, label: 'LKP trailhead', labelDy: -14 },
    pls: { x: 610, y: 210, label: 'PLS Pika Overlook' },
    icp: { x: 90, y: 640, label: 'ICP' },
  },
  trails: [
    // main trail: trailhead to overlook
    [[140, 590], [230, 520], [330, 470], [420, 400], [500, 330], [560, 260], [610, 210]],
    // ridge spur
    [[610, 210], [700, 170], [800, 150], [900, 120]],
    // creek trail
    [[330, 470], [380, 540], [470, 590], [590, 610], [720, 600]],
  ],
  // Segments: initial probability of area (POA) sums to 100.
  // detectability: how easy a subject is to spot per unit of effort.
  segments: [
    { id: 'A1', name: 'Trailhead approach', terrain: 'Open trail, meadow', poa: 4, detect: 0.9, areaHa: 40, labelDx: 40, labelDy: 30, poly: [[60, 560], [260, 520], [300, 640], [80, 660]] },
    { id: 'A2', name: 'Lower switchbacks', terrain: 'Forested trail, moderate slope', poa: 8, detect: 0.6, areaHa: 55, poly: [[260, 520], [420, 440], [470, 540], [300, 640]] },
    { id: 'B1', name: 'Upper trail to overlook', terrain: 'Steep trail, exposed', poa: 14, detect: 0.7, areaHa: 60, poly: [[420, 440], [560, 300], [640, 340], [520, 480], [470, 540]] },
    { id: 'B2', name: 'Pika Overlook and cliff band', terrain: 'Cliffs, talus below overlook', poa: 22, detect: 0.4, areaHa: 35, poly: [[560, 300], [640, 180], [720, 230], [640, 340]] },
    { id: 'C1', name: 'East ridge spur', terrain: 'Ridgeline, scree, wind exposed', poa: 15, detect: 0.5, areaHa: 70, poly: [[640, 180], [820, 90], [960, 120], [900, 220], [720, 230]] },
    { id: 'C2', name: 'North drainage', terrain: 'Dense timber, deadfall, steep gully', poa: 12, detect: 0.25, areaHa: 90, poly: [[500, 60], [820, 90], [640, 180], [560, 300], [430, 200]] },
    { id: 'D1', name: 'Creek trail', terrain: 'Riparian, brushy, wet', poa: 9, detect: 0.5, areaHa: 65, poly: [[300, 640], [470, 540], [520, 480], [640, 340], [720, 380], [740, 560], [600, 660]] },
    { id: 'D2', name: 'Beaver ponds', terrain: 'Marsh, ponds, poor footing', poa: 6, detect: 0.35, areaHa: 50, poly: [[740, 560], [720, 380], [900, 400], [960, 560], [780, 660]] },
    { id: 'E1', name: 'West bench', terrain: 'Old growth, gentle, off-trail', poa: 10, detect: 0.45, areaHa: 85, poly: [[60, 300], [430, 200], [500, 60], [80, 60]] },
  ],
  teams: [
    { id: 'T1', callsign: 'Ground 1', type: 'ground', members: 4, hoursOnTask: 3.2, skills: ['tracking'], status: 'searching', segment: 'A2', segmentsSearched: ['A1'] },
    { id: 'T2', callsign: 'Ground 2', type: 'ground', members: 5, hoursOnTask: 2.5, skills: ['medical'], status: 'searching', segment: 'B1', segmentsSearched: [] },
    { id: 'T3', callsign: 'Hasty 3', type: 'hasty', members: 2, hoursOnTask: 3.4, skills: ['trail running'], status: 'returning', segment: null, segmentsSearched: ['B1', 'C1'] },
    { id: 'T4', callsign: 'K9 Juno', type: 'dog', members: 2, hoursOnTask: 1.1, skills: ['air scent'], status: 'available', segment: null, segmentsSearched: [] },
    { id: 'T5', callsign: 'Drone 5', type: 'uav', members: 2, hoursOnTask: 0.5, skills: ['thermal'], status: 'available', segment: null, segmentsSearched: [] },
    { id: 'T6', callsign: 'Ground 6', type: 'ground', members: 4, hoursOnTask: 0, skills: ['rope rescue'], status: 'available', segment: null, segmentsSearched: [] },
  ],
  // Searches already completed. POD applied to segment coverage.
  completedSearches: [
    { team: 'T1', segment: 'A1', pod: 0.75, note: 'Trail and meadow swept both sides' },
    { team: 'T3', segment: 'B1', pod: 0.35, note: 'Hasty sweep of trail corridor only' },
    { team: 'T3', segment: 'C1', pod: 0.3, note: 'Ran the ridge trail to the saddle, no sign' },
  ],
  clues: [
    { id: 'K1', segment: 'B1', description: 'Granola bar wrapper on trail edge, brand matches subject purchase', time: '16:05', foundBy: 'Ground 2' },
  ],
  log: [
    { time: '14:10', author: 'IC', text: 'Incident opened. Subject overdue from Cedar Ridge day hike.' },
    { time: '14:40', author: 'IC', text: 'Hasty 3 dispatched up main trail toward Pika Overlook.' },
    { time: '15:15', author: 'IC', text: 'Ground 1 assigned A1 then A2. Ground 2 assigned B1.' },
    { time: '16:05', author: 'Ground 2', text: 'Clue K1 located in B1, flagged and photographed.' },
    { time: '17:20', author: 'IC', text: 'Hasty 3 reports ridge to saddle clear, returning to ICP.' },
  ],
};

// Effort model per team type: relative sweep rate (hectares per hour equivalent)
export const TEAM_RATES = {
  ground: 12,
  hasty: 30,
  dog: 25,
  uav: 60,
};

export const TEAM_LABELS = {
  ground: 'Ground team',
  hasty: 'Hasty team',
  dog: 'K9 team',
  uav: 'UAV team',
};
