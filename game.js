(() => {
  const canvas = document.getElementById('gameCanvas')
  const ctx = canvas.getContext('2d')
  const mainMenu = document.getElementById('mainMenu')
  const menuDiscoverBtn = document.getElementById('menuDiscoverBtn')
  const menuSolveBtn = document.getElementById('menuSolveBtn')
  const gameHud = document.getElementById('gameHud')
  const backBtn = document.getElementById('backBtn')
  const resetBtn = document.getElementById('resetBtn')
  const levelBadge = document.getElementById('levelBadge')
  const nextBtn = document.getElementById('nextBtn')
  const feedback = document.getElementById('feedback')

  const WORLD = { w: 1280, h: 720 }
  const TOOTH_PITCH = 28
  const TOOTH_DEPTH = 24
  const TOOTH_ADDENDUM = TOOTH_DEPTH * 0.40
  const TOOTH_DEDENDUM = TOOTH_DEPTH * 0.60
  const MESH_TOOTH_OVERLAP = 0
  const RACK_TOOTH_PHASE = 0
  const RACK_GEAR_PHASE_OFFSET = TOOTH_PITCH / 2
  const DEBUG_MESH = false
  const SNAP_TOLERANCE = 50
  const LINK_DISTANCE_TOLERANCE = 14
  const LINK_PHASE_TOLERANCE = 0.08
  const VISUAL_COLLISION_PADDING = 0
  const CONTACT_LINE_PADDING = 4
  const START_SPEED = 0.34
  const MAX_DISCOVER_GEARS = 10
  const TWO_PI = Math.PI * 2

  const DISCOVER_GEAR_VARIANTS = [
    { teeth: 10, color: '#4fb5e8', accent: '#d9f5ff' },
    { teeth: 12, color: '#ffd34e', accent: '#fff3b0' },
    { teeth: 14, color: '#f6a33b', accent: '#ffe6a7' },
    { teeth: 16, color: '#8fd15a', accent: '#e5ffd0' },
    { teeth: 18, color: '#8261d4', accent: '#e5dcff' },
    { teeth: 22, color: '#ec6fae', accent: '#ffd8eb' }
  ]
  const DISCOVER_UI = {
    add: { x: 1118, y: 142, size: 78 },
    trash: { x: 1118, y: 590, size: 92 }
  }
  const SOLVE_LEVEL_1 = {
    name: 'Deur',
    machine: 'door',
    target: { x: 650, teeth: 12, angle: 0 },
    stock: [
      { teeth: 12, color: '#4fb5e8', accent: '#d9f5ff' }
    ]
  }

  const LEVEL_1_DOOR = {
    panelClosedX: 792,
    panelY: 138,
    panelW: 228,
    panelH: 430,
    travel: 228,
    rackClosedX: 470,
    rackY: 183,
    rackW: 560,
    rackH: 43,
    brackets: [
      { x: 748, y: 170, w: 34, h: 68 },
      { x: 1002, y: 170, w: 34, h: 68 }
    ],
    frameOverlay: { x: 748, y: 88, w: 292, h: 492, openingX: 806, openingY: 138, openingW: 202, openingH: 430 }
  }

  const assets = loadImages({
    background: 'assets/background.png',
    level1Background: 'assets/background2.png',
    robot: 'assets/01_neutraal_transparant.png',
    robotBlink1: 'assets/01_neutraal_transparant01.png',
    robotBlink2: 'assets/01_neutraal_transparant02.png',
    room: 'assets/vertrek.png',
    slidingDoor: 'assets/schuifdeur.png',
    bracket: 'assets/beugel.png',
    rack: 'assets/tandheugel.png',
    machineGear: 'assets/tandwiel.png'
  })

  let mode = 'menu'
  let gears = []
  let links = []
  let drag = null
  let lastTime = performance.now()
  let clickEffects = []
  let hasDraggedDiscover = false
  let hintAlpha = 1
  let nextDiscoverGearIndex = 0
  let solveLevelIndex = 0
  let levelComplete = false
  let machineProgress = 0
  let doorProgress = 0
  let debugMeshLinks = []
  let debugRackState = null
  const LEVEL_1_RACK_TRAVEL = LEVEL_1_DOOR.travel

  function loadImages(map){
    const out = {}
    Object.entries(map).forEach(([key, src]) => {
      const img = new Image()
      img.onload = () => { img.ready = true }
      img.onerror = () => { img.ready = false }
      img.src = src
      out[key] = img
    })
    return out
  }

  function clamp(v, min, max){ return Math.max(min, Math.min(max, v)) }
  function normAngle(a){ return Math.atan2(Math.sin(a), Math.cos(a)) }
  function dist(a, b){ return Math.hypot(a.x - b.x, a.y - b.y) }
  function currentMeshToothOverlap(){ return MESH_TOOTH_OVERLAP }
  function positiveModulo(value, modulo){ return ((value % modulo) + modulo) % modulo }
  function pitchPhaseError(value){ return Math.abs(positiveModulo(value + TOOTH_PITCH / 2, TOOTH_PITCH) - TOOTH_PITCH / 2) }
  function visualCollisionRadius(gear){ return gear.pitchRadius - currentMeshToothOverlap() / 2 + VISUAL_COLLISION_PADDING }

  function gearRadii(teeth){
    const pitchRadius = teeth * TOOTH_PITCH / TWO_PI
    return {
      pitchRadius,
      outerRadius: pitchRadius + TOOTH_ADDENDUM,
      rootRadius: pitchRadius - TOOTH_DEDENDUM,
      boreRadius: Math.max(18, pitchRadius * 0.23)
    }
  }

  function makeGear(id, x, y, teeth, color, opts = {}){
    const radii = gearRadii(teeth)
    return {
      id, x, y, teeth, color,
      homeX: opts.homeX ?? x,
      homeY: opts.homeY ?? y,
      accent: opts.accent || '#ffffff',
      fixed: !!opts.fixed,
      driver: !!opts.driver,
      target: !!opts.target,
      stock: !!opts.stock,
      angle: opts.angle || 0,
      speed: opts.speed || 0,
      rotationSpeed: opts.speed || 0,
      parentGearId: opts.parentGearId || null,
      pulse: 0,
      ...radii
    }
  }

  function showMenu(){
    mode = 'menu'
    drag = null
    mainMenu.hidden = false
    gameHud.hidden = true
    levelBadge.hidden = true
    resetBtn.hidden = true
    nextBtn.hidden = true
    gears = []
    links = []
    clickEffects = []
    machineProgress = 0
    doorProgress = 0
  }

  function startDiscover(){
    mode = 'discover'
    mainMenu.hidden = true
    gameHud.hidden = false
    levelBadge.hidden = true
    resetBtn.hidden = true
    nextBtn.hidden = true
    resetDiscover()
  }

  function startSolveLevel1(){
    mode = 'solve'
    solveLevelIndex = 0
    mainMenu.hidden = true
    gameHud.hidden = false
    levelBadge.hidden = false
    resetBtn.hidden = false
    nextBtn.hidden = true
    resetSolveLevel1()
  }

  function startSolve(levelIndex = 0){
    startSolveLevel1()
  }

  function resetDiscover(){
    gears = [
      makeGear('start', 275, 365, 18, '#59c765', { fixed:true, driver:true, speed:START_SPEED, accent:'#dff6a8' }),
      makeGear('blue', 610, 230, 10, '#4fb5e8', { accent:'#d9f5ff', angle:.2 }),
      makeGear('orange', 680, 505, 14, '#f6a33b', { accent:'#ffe6a7', angle:.7 }),
      makeGear('pink', 930, 330, 22, '#ec6fae', { accent:'#ffd8eb', angle:1.1 })
    ]
    links = []
    clickEffects = []
    hasDraggedDiscover = false
    hintAlpha = 1
    nextDiscoverGearIndex = 0
    propagateRotation()
  }

  function resetSolveLevel1(){
    const level = SOLVE_LEVEL_1
    levelBadge.textContent = '1. Deur'
    levelComplete = false
    machineProgress = 0
    doorProgress = 0
    nextBtn.hidden = true
    feedback.classList.remove('show')
    const targetRadii = gearRadii(level.target.teeth)
    const targetY = rackPitchLineY() + targetRadii.pitchRadius
    const start = makeGear('start', 450, 410, 18, '#59c765', { fixed:true, driver:true, speed:-START_SPEED, accent:'#dff6a8' })
    const target = makeGear('target', level.target.x, targetY, level.target.teeth, '#ec6fae', { fixed:true, target:true, accent:'#ffd8eb', angle: level.target.angle })
    gears = [start, target]
    links = []
    level.stock.forEach((item, index) => {
      const position = level1StartMeshPosition(start, target, item.teeth)
      gears.push(makeGear(`stock-${index}`, position.x, position.y, item.teeth, item.color, {
        accent: item.accent,
        fixed: false,
        stock: false,
        angle: index * .35
      }))
    })
    primeSolveStartPhaseForInitialChain()
    rebuildSolveLinks()
  }

  function resetSolveLevel(){
    resetSolveLevel1()
  }

  function primeSolveStartPhaseForInitialChain(){
    const start = getGear('start')
    const target = getGear('target')
    const bridge = gears.find(g => !g.driver && !g.target && !g.stock)
    if(!start || !target || !bridge) return
    alignTargetGearToRack(target)
    alignGearToGearMesh(target, bridge)
    alignGearToGearMesh(bridge, start)
  }

  function level1StartMeshPosition(start, target, teeth){
    const radii = gearRadii(teeth)
    const startDistance = meshDistance(start, radii)
    const targetDistance = meshDistance(target, radii)
    const dx = target.x - start.x
    const dy = target.y - start.y
    const centerDistance = Math.hypot(dx, dy)
    const along = (startDistance * startDistance - targetDistance * targetDistance + centerDistance * centerDistance) / (2 * centerDistance)
    const height = Math.sqrt(Math.max(0, startDistance * startDistance - along * along))
    const ux = dx / centerDistance
    const uy = dy / centerDistance
    return {
      x: start.x + ux * along - uy * height,
      y: start.y + uy * along + ux * height
    }
  }

  function getGear(id){ return gears.find(g => g.id === id) }
  function connectedTo(id){ return links.flatMap(l => l.a === id ? [l.b] : l.b === id ? [l.a] : []) }
  function solveFieldGears(){ return gears.filter(g => !g.stock) }
  function hasLink(aId, bId){ return links.some(l => (l.a === aId && l.b === bId) || (l.a === bId && l.b === aId)) }
  function drivenGearIds(){
    const queue = gears.filter(g => g.driver)
    const seen = new Set(queue.map(g => g.id))
    while(queue.length){
      const gear = queue.shift()
      connectedTo(gear.id).forEach(nextId => {
        if(seen.has(nextId)) return
        const next = getGear(nextId)
        if(!next || next.stock) return
        seen.add(nextId)
        queue.push(next)
      })
    }
    return seen
  }
  function addGearLink(parent, child){
    if(!parent || !child || parent.id === child.id || hasLink(parent.id, child.id)) return false
    links.push({ a: parent.id, b: child.id })
    if(!child.driver && !child.parentGearId) child.parentGearId = parent.id
    return true
  }

  function rebuildGearGraph({ alignChildren = true } = {}){
    if(mode === 'solve') return buildSolveConstraintGraph({ applyAngles: alignChildren }).driven

    gears.forEach(g => { if(!g.driver) g.parentGearId = null })
    const queue = gears.filter(g => g.driver)
    const seen = new Set(queue.map(g => g.id))
    const keepLinks = []

    while(queue.length){
      const parent = queue.shift()
      links.forEach(link => {
        const nextId = link.a === parent.id ? link.b : link.b === parent.id ? link.a : null
        if(!nextId) return
        const child = getGear(nextId)
        if(!child || child.stock) return

        if(seen.has(child.id)){
          if(gearMeshPhaseFits(parent, child) && !hasLinkInList(keepLinks, parent.id, child.id)) keepLinks.push(link)
          return
        }

        if(!isValidLinkGeometry(parent, child)) return
        if(alignChildren && !child.fixed) alignGearToGearMesh(parent, child)
        if(!gearMeshPhaseFits(parent, child)) return

        child.parentGearId = parent.id
        seen.add(child.id)
        queue.push(child)
        if(!hasLinkInList(keepLinks, parent.id, child.id)) keepLinks.push(link)
      })
    }

    links.forEach(link => {
      const a = getGear(link.a)
      const b = getGear(link.b)
      if(!a || !b || seen.has(a.id) || seen.has(b.id) || !isValidLink(a, b)) return
      if(!hasLinkInList(keepLinks, a.id, b.id)) keepLinks.push(link)
    })

    links = keepLinks
    return seen
  }

  function hasLinkInList(list, aId, bId){
    return list.some(l => (l.a === aId && l.b === bId) || (l.a === bId && l.b === aId))
  }

  function propagateRotation(){
    rebuildGearGraph({ alignChildren: false })
    gears.forEach(g => { if(!g.driver) g.speed = 0 })
    const queue = gears.filter(g => g.driver)
    const seen = new Set(queue.map(g => g.id))
    while(queue.length){
      const gear = queue.shift()
      connectedTo(gear.id).forEach(nextId => {
        const next = getGear(nextId)
        if(!next || seen.has(next.id) || next.parentGearId !== gear.id) return
        next.speed = -gear.speed * gear.teeth / next.teeth
        seen.add(next.id)
        queue.push(next)
      })
    }
    gears.forEach(g => { g.rotationSpeed = g.speed })
  }

  function disconnectGear(gear){
    if(!gear || gear.driver || gear.fixed) return
    removeLinksForGear(gear.id)
    gear.speed = 0
    propagateRotation()
    if(mode === 'solve') checkSolveState()
  }

  function toggleStartDirection(){
    const start = getGear('start')
    if(!start) return
    start.speed = -start.speed || START_SPEED
    propagateRotation()
    popClick(start.x, start.y, start)
  }

  function meshDistance(a, b){ return a.pitchRadius + b.pitchRadius - currentMeshToothOverlap() }
  function rackXForProgress(t = doorProgress){ return LEVEL_1_DOOR.rackClosedX - LEVEL_1_DOOR.travel * t }
  function rackPitchLineY(){ return LEVEL_1_DOOR.rackY + LEVEL_1_DOOR.rackH }
  function rackGapPhase(){ return RACK_TOOTH_PHASE + RACK_GEAR_PHASE_OFFSET }

  function nearestValleyAngle(anchor, angle){
    const pitchAngle = TWO_PI / anchor.teeth
    const valleyIndex = Math.round((normAngle(angle - anchor.angle) / pitchAngle) - 0.5)
    return anchor.angle + (valleyIndex + 0.5) * pitchAngle
  }

  function meshedGearAngleFor(anchorGear, anchorAngle, childGear, childAngle = childGear.angle){
    const meshAngle = Math.atan2(childGear.y - anchorGear.y, childGear.x - anchorGear.x)
    const anchorPitch = TWO_PI / anchorGear.teeth
    const childPitch = TWO_PI / childGear.teeth
    const anchorPhaseAtContact = normAngle(meshAngle - anchorAngle) / anchorPitch
    const childPhaseAtContact = anchorPhaseAtContact + 0.5
    const baseAngle = meshAngle + Math.PI - childPhaseAtContact * childPitch
    const nearestToCurrent = Math.round((childAngle - baseAngle) / childPitch)
    return baseAngle + nearestToCurrent * childPitch
  }

  function meshedGearAngle(anchorGear, childGear){
    return meshedGearAngleFor(anchorGear, anchorGear.angle, childGear, childGear.angle)
  }

  function alignGearToGearMesh(anchorGear, childGear){
    childGear.angle = meshedGearAngle(anchorGear, childGear)
  }

  function gearMeshPhaseFitsFor(anchorGear, anchorAngle, childGear, childAngle){
    return Math.abs(normAngle(childAngle - meshedGearAngleFor(anchorGear, anchorAngle, childGear, childAngle))) <= LINK_PHASE_TOLERANCE
  }

  function gearMeshPhaseFits(anchorGear, childGear){
    return gearMeshPhaseFitsFor(anchorGear, anchorGear.angle, childGear, childGear.angle)
  }

  function gearLinkDistanceError(a, b){ return Math.abs(dist(a, b) - meshDistance(a, b)) }

  function rackMeshState(target, angle = target?.angle){
    if(!target) return { valid:false, geometryValid:false, phaseValid:false, gapError:Infinity }
    const pitchY = rackPitchLineY()
    const geometryError = Math.abs((target.y - target.pitchRadius) - pitchY)
    const rackSpace = target.x - rackXForProgress() + (angle + Math.PI / 2) * target.pitchRadius
    const gapError = pitchPhaseError(rackSpace - rackGapPhase())
    const geometryValid = geometryError <= 1.5
    const phaseValid = gapError <= 0.75
    return { valid: geometryValid && phaseValid, geometryValid, phaseValid, geometryError, gapError, contact:{ x:target.x, y:pitchY } }
  }

  function alignSolveLevel1Phases(){
    const target = getGear('target')
    if(target) alignTargetGearToRack(target)
    rebuildGearGraph({ alignChildren: true })
  }

  function alignTargetGearToRack(target){
    const localContactX = target.x - rackXForProgress()
    const currentRackSpace = localContactX + (target.angle + Math.PI / 2) * target.pitchRadius
    const gapIndex = Math.round((currentRackSpace - rackGapPhase()) / TOOTH_PITCH)
    const targetRackSpace = rackGapPhase() + gapIndex * TOOTH_PITCH
    target.angle = (targetRackSpace - localContactX) / target.pitchRadius - Math.PI / 2
  }

  function solveRackClearanceY(gear){
    if(mode !== 'solve' || gear.target) return 108 + gear.outerRadius
    return Math.max(108 + gear.outerRadius, LEVEL_1_DOOR.rackY + LEVEL_1_DOOR.rackH + gear.outerRadius + 28)
  }

  function violatesSolveRackClearance(gear){
    if(mode !== 'solve' || gear.target || gear.stock) return false
    return gear.y < solveRackClearanceY(gear)
  }

  function wouldOverlapAnyGear(candidateGear, ignoredGearIds = []){
    const ignored = new Set(ignoredGearIds)
    return gears.some(other => {
      if(other.id === candidateGear.id || ignored.has(other.id) || other.stock) return false
      const minDistance = visualCollisionRadius(candidateGear) + visualCollisionRadius(other)
      return dist(candidateGear, other) < minDistance - 0.5
    })
  }

  function distanceToSegment(p, a, b){
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lenSq = dx * dx + dy * dy
    if(lenSq === 0) return { distance: dist(p, a), t: 0 }
    const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq, 0, 1)
    return { distance: Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)), t }
  }

  function isContactBlocked(anchor, loose){
    const endpointClearance = Math.min(anchor.pitchRadius, loose.pitchRadius) * .45
    const contactDistance = dist(anchor, loose)
    return gears.some(other => {
      if(other.id === anchor.id || other.id === loose.id || other.stock) return false
      const hit = distanceToSegment(other, anchor, loose)
      const distanceFromAnchor = hit.t * contactDistance
      const distanceFromLoose = (1 - hit.t) * contactDistance
      if(distanceFromAnchor < endpointClearance || distanceFromLoose < endpointClearance) return false
      return hit.distance < visualCollisionRadius(other) + CONTACT_LINE_PADDING
    })
  }

  function isValidLinkGeometry(anchor, loose){
    const wanted = meshDistance(anchor, loose)
    if(anchor.stock || loose.stock) return false
    if(Math.abs(dist(anchor, loose) - wanted) > LINK_DISTANCE_TOLERANCE) return false
    if(isContactBlocked(anchor, loose)) return false
    if(violatesSolveRackClearance(anchor) || violatesSolveRackClearance(loose)) return false
    if(wouldOverlapAnyGear(anchor, [loose.id]) || wouldOverlapAnyGear(loose, [anchor.id])) return false
    return true
  }

  function isValidLink(anchor, loose){
    return isValidLinkGeometry(anchor, loose) && gearMeshPhaseFits(anchor, loose)
  }

  function candidateGearLinksForSolve(){
    const fieldGears = solveFieldGears()
    const candidates = []
    for(let i = 0; i < fieldGears.length; i++){
      for(let j = i + 1; j < fieldGears.length; j++){
        const a = fieldGears[i]
        const b = fieldGears[j]
        if(!isValidLinkGeometry(a, b)) continue
        candidates.push({ a:a.id, b:b.id, error:gearLinkDistanceError(a, b) })
      }
    }
    return candidates.sort((a, b) => a.error - b.error)
  }

  function buildSolveConstraintGraph({ applyAngles = false } = {}){
    const start = getGear('start')
    const target = getGear('target')
    const accepted = []
    const rejected = []
    const driven = new Set()
    const phaseById = new Map()
    const parentById = new Map()
    const candidates = candidateGearLinksForSolve()
    const adjacency = new Map()

    gears.forEach(g => { if(!g.driver) g.parentGearId = null })
    candidates.forEach(link => {
      if(!adjacency.has(link.a)) adjacency.set(link.a, [])
      if(!adjacency.has(link.b)) adjacency.set(link.b, [])
      adjacency.get(link.a).push(link)
      adjacency.get(link.b).push(link)
    })

    if(start){
      driven.add(start.id)
      phaseById.set(start.id, start.angle)
      const queue = [start.id]
      while(queue.length){
        const parentId = queue.shift()
        const parent = getGear(parentId)
        const parentAngle = phaseById.get(parentId)
        ;(adjacency.get(parentId) || []).forEach(link => {
          const childId = link.a === parentId ? link.b : link.a
          const child = getGear(childId)
          if(!parent || !child) return

          if(driven.has(childId)){
            const fits = gearMeshPhaseFitsFor(parent, parentAngle, child, phaseById.get(childId))
            if(fits){
              if(!hasLinkInList(accepted, parent.id, child.id)) accepted.push({ a:parent.id, b:child.id })
            } else rejected.push({ a:parent.id, b:child.id, reason:'phase' })
            return
          }

          const childAngle = meshedGearAngleFor(parent, parentAngle, child, child.angle)
          const rackState = child.target ? rackMeshState(child, childAngle) : null
          if(child.target && !rackState.valid){
            rejected.push({ a:parent.id, b:child.id, reason:'rack' })
            return
          }

          driven.add(childId)
          phaseById.set(childId, childAngle)
          parentById.set(childId, parent.id)
          accepted.push({ a:parent.id, b:child.id })
          queue.push(childId)
        })
      }
    }

    candidates.forEach(link => {
      if(hasLinkInList(accepted, link.a, link.b) || hasLinkInList(rejected, link.a, link.b)) return
      if(!driven.has(link.a) || !driven.has(link.b)) return
      const a = getGear(link.a)
      const b = getGear(link.b)
      const fits = a && b && gearMeshPhaseFitsFor(a, phaseById.get(a.id), b, phaseById.get(b.id))
      if(fits) accepted.push({ a:link.a, b:link.b })
      else rejected.push({ a:link.a, b:link.b, reason:'phase' })
    })

    debugRackState = target ? rackMeshState(target, phaseById.get(target.id) ?? target.angle) : null
    debugMeshLinks = candidates.map(link => ({ ...link, valid:hasLinkInList(accepted, link.a, link.b), rejected:hasLinkInList(rejected, link.a, link.b) }))

    links = accepted
    if(applyAngles){
      phaseById.forEach((angle, id) => {
        const gear = getGear(id)
        if(gear && !gear.driver) gear.angle = angle
      })
    }
    parentById.forEach((parentId, childId) => {
      const child = getGear(childId)
      if(child && !child.driver) child.parentGearId = parentId
    })
    return { driven, accepted, rejected, phaseById, rackState:debugRackState }
  }

  function validateLinks(){
    if(mode === 'solve'){
      buildSolveConstraintGraph({ applyAngles:false })
      return
    }
    links = links.filter(link => {
      const a = getGear(link.a)
      const b = getGear(link.b)
      return a && b && isValidLinkGeometry(a, b)
    })
    rebuildGearGraph({ alignChildren: false })
  }

  function rebuildSolveLinks(){
    buildSolveConstraintGraph({ applyAngles:true })
    propagateRotation()
    checkSolveState()
  }

  function trySnap(gear){
    if(mode === 'discover') return trySnapDiscover(gear)
    if(mode === 'solve') return trySnapSolve(gear)
    return false
  }

  function trySnapDiscover(gear){
    validateLinks()
    const candidates = gears
      .filter(g => g.id !== gear.id && Math.abs(g.speed) > 0.001)
      .map(anchor => ({ anchor, error: Math.abs(dist(anchor, gear) - meshDistance(anchor, gear)) }))
      .filter(candidate => candidate.error < SNAP_TOLERANCE)
      .sort((a, b) => a.error - b.error)
    return snapToFirstCandidate(gear, candidates, true)
  }

  function trySnapSolve(gear){
    const snapped = snapToSolveConstraintPosition(gear)
    checkSolveState()
    return snapped
  }

  function solveSnapAnchors(gear){
    const powered = drivenGearIds()
    return gears
      .filter(anchor => anchor.id !== gear.id && !anchor.stock)
      .map(anchor => ({
        anchor,
        powered: powered.has(anchor.id),
        error: Math.abs(dist(anchor, gear) - meshDistance(anchor, gear))
      }))
      .filter(candidate => candidate.error < SNAP_TOLERANCE)
      .sort((a, b) => (b.powered - a.powered) || a.error - b.error)
  }

  function circleIntersections(a, ar, b, br){
    const dx = b.x - a.x
    const dy = b.y - a.y
    const d = Math.hypot(dx, dy)
    if(d <= 0.0001 || d > ar + br || d < Math.abs(ar - br)) return []
    const along = (ar * ar - br * br + d * d) / (2 * d)
    const heightSq = ar * ar - along * along
    if(heightSq < -0.0001) return []
    const h = Math.sqrt(Math.max(0, heightSq))
    const ux = dx / d
    const uy = dy / d
    const base = { x: a.x + ux * along, y: a.y + uy * along }
    return [
      { x: base.x - uy * h, y: base.y + ux * h },
      { x: base.x + uy * h, y: base.y - ux * h }
    ]
  }

  function candidateSolveSnapPositions(gear, snapAnchors){
    const positions = []
    const addPosition = (x, y, anchors) => {
      const probe = { ...gear, stock:false, x, y }
      if(wouldOverlapAnyGear(probe, anchors.map(a => a.id))) return
      if(violatesSolveRackClearance(probe)) return
      if(anchors.some(anchor => isContactBlocked(anchor, probe))) return
      const error = anchors.reduce((sum, anchor) => sum + Math.abs(dist(anchor, probe) - meshDistance(anchor, probe)), 0)
      positions.push({ x, y, anchors, error, contactCount: anchors.length })
    }

    for(let i = 0; i < snapAnchors.length; i++){
      const first = snapAnchors[i].anchor
      const rawAngle = Math.atan2(gear.y - first.y, gear.x - first.x)
      const wanted = meshDistance(first, gear)
      addPosition(first.x + Math.cos(rawAngle) * wanted, first.y + Math.sin(rawAngle) * wanted, [first])

      for(let j = i + 1; j < snapAnchors.length; j++){
        const second = snapAnchors[j].anchor
        circleIntersections(first, meshDistance(first, gear), second, meshDistance(second, gear))
          .forEach(point => {
            if(Math.hypot(point.x - gear.x, point.y - gear.y) > SNAP_TOLERANCE * 1.8) return
            addPosition(point.x, point.y, [first, second])
          })
      }
    }

    const powered = drivenGearIds()
    return positions.sort((a, b) =>
      (b.contactCount - a.contactCount) ||
      (b.anchors.some(anchor => powered.has(anchor.id)) - a.anchors.some(anchor => powered.has(anchor.id))) ||
      a.error - b.error ||
      Math.hypot(a.x - gear.x, a.y - gear.y) - Math.hypot(b.x - gear.x, b.y - gear.y)
    )
  }

  function linkAccepted(list, aId, bId){
    return hasLinkInList(list, aId, bId)
  }

  function linkRejected(list, aId, bId){
    return hasLinkInList(list, aId, bId)
  }

  function physicalSolveContactsFor(gear){
    return solveFieldGears()
      .filter(other => other.id !== gear.id)
      .filter(other => isValidLinkGeometry(other, gear))
  }

  function snapToSolveConstraintPosition(gear){
    const snapAnchors = solveSnapAnchors(gear)
    if(!snapAnchors.length) return false

    const original = { x: gear.x, y: gear.y, angle: gear.angle, stock: gear.stock, parentGearId: gear.parentGearId }
    const originalLinks = links.slice()
    const positions = candidateSolveSnapPositions(gear, snapAnchors)

    for(const position of positions){
      links = originalLinks.slice()
      Object.assign(gear, original)
      removeLinksForGear(gear.id)
      gear.stock = false
      gear.x = position.x
      gear.y = position.y

      const result = buildSolveConstraintGraph({ applyAngles:true })
      const physicalContacts = physicalSolveContactsFor(gear)
      const intendedContacts = new Set(position.anchors.map(anchor => anchor.id))
      const allPhysicalContactsFit = physicalContacts.every(anchor => {
        if(linkRejected(result.rejected, anchor.id, gear.id)) return false
        if(result.driven.has(anchor.id) || result.driven.has(gear.id)) return linkAccepted(result.accepted, anchor.id, gear.id)
        return !intendedContacts.has(anchor.id)
      })
      const intendedContactsFit = position.anchors.every(anchor => linkAccepted(result.accepted, anchor.id, gear.id))

      if(result.driven.has(gear.id) && intendedContactsFit && allPhysicalContactsFit){
        propagateRotation()
        popClick(gear.x, gear.y, gear)
        return true
      }
    }

    links = originalLinks
    Object.assign(gear, original)
    return false
  }

  function snapToFirstCandidate(gear, candidates, singleLink){
    const original = { x: gear.x, y: gear.y, angle: gear.angle, stock: gear.stock, parentGearId: gear.parentGearId }
    const originalLinks = links.slice()

    for(const candidate of candidates){
      const rawAngle = Math.atan2(gear.y - candidate.anchor.y, gear.x - candidate.anchor.x)
      const meshAngle = nearestValleyAngle(candidate.anchor, rawAngle)
      const wanted = meshDistance(candidate.anchor, gear)
      const snappedGear = { ...gear, stock:false, x: candidate.anchor.x + Math.cos(meshAngle) * wanted, y: candidate.anchor.y + Math.sin(meshAngle) * wanted }
      if(wouldOverlapAnyGear(snappedGear, [candidate.anchor.id])) continue
      if(violatesSolveRackClearance(snappedGear)) continue
      if(isContactBlocked(candidate.anchor, snappedGear)) continue

      links = originalLinks.slice()
      Object.assign(gear, original)
      removeLinksForGear(gear.id)
      gear.stock = false
      gear.x = snappedGear.x
      gear.y = snappedGear.y
      alignGearToGearMesh(candidate.anchor, gear)

      if(mode === 'solve'){
        const result = buildSolveConstraintGraph({ applyAngles:true })
        if(!result.driven.has(gear.id) || !hasLink(candidate.anchor.id, gear.id)){
          links = originalLinks.slice()
          Object.assign(gear, original)
          continue
        }
      } else {
        addGearLink(candidate.anchor, gear)
        validateLinks()
        if(!hasLink(candidate.anchor.id, gear.id) || gear.parentGearId !== candidate.anchor.id){
          links = originalLinks.slice()
          Object.assign(gear, original)
          continue
        }
      }

      propagateRotation()
      popClick(gear.x, gear.y, gear)
      return true
    }

    links = originalLinks
    Object.assign(gear, original)
    return false
  }

  function removeLinksForGear(id){
    links = links.filter(l => l.a !== id && l.b !== id)
    gears.forEach(g => { if(g.parentGearId === id || g.id === id) g.parentGearId = null })
  }

  function removeGear(gear){
    if(!gear || gear.driver) return false
    gears = gears.filter(g => g.id !== gear.id)
    removeLinksForGear(gear.id)
    validateLinks()
    propagateRotation()
    return true
  }

  function addDiscoverGear(){
    if(mode !== 'discover' || gears.length >= MAX_DISCOVER_GEARS) return false
    const variant = DISCOVER_GEAR_VARIANTS[nextDiscoverGearIndex % DISCOVER_GEAR_VARIANTS.length]
    nextDiscoverGearIndex += 1
    const radii = gearRadii(variant.teeth)
    const columns = [930, 815, 700]
    const rows = [150, 305, 460]
    let best = null
    columns.forEach(x => rows.forEach(y => {
      const clear = gears.every(g => Math.hypot(g.x - x, g.y - y) > g.outerRadius + radii.outerRadius + 28)
      const nearest = gears.reduce((min, g) => Math.min(min, Math.hypot(g.x - x, g.y - y)), Infinity)
      if((clear || !best) && (!best || (clear && !best.clear) || nearest > best.nearest)) best = { x, y, clear, nearest }
    }))
    const gear = makeGear(`extra-${Date.now()}-${nextDiscoverGearIndex}`, best?.x || 940, best?.y || 180, variant.teeth, variant.color, {
      accent: variant.accent,
      angle: nextDiscoverGearIndex * .35
    })
    gears.push(gear)
    popClick(gear.x, gear.y, gear)
    return true
  }

  function hitDiscoverButton(p){
    if(mode !== 'discover') return null
    const add = DISCOVER_UI.add
    if(Math.abs(p.x - add.x) <= add.size / 2 && Math.abs(p.y - add.y) <= add.size / 2) return 'add'
    return null
  }

  function overTrash(p){
    if(mode !== 'discover') return false
    const trash = DISCOVER_UI.trash
    return Math.abs(p.x - trash.x) <= trash.size / 2 && Math.abs(p.y - trash.y) <= trash.size / 2
  }

  function popClick(x, y, gear){
    gear.pulse = 1
    clickEffects.push({ x, y, age: 0 })
  }

  function gearAt(p){
    for(let i = gears.length - 1; i >= 0; i--){
      const g = gears[i]
      if(Math.hypot(p.x - g.x, p.y - g.y) <= g.outerRadius + 10) return g
    }
    return null
  }

  function pointerToWorld(evt){
    const rect = canvas.getBoundingClientRect()
    return {
      x: (evt.clientX - rect.left) / rect.width * WORLD.w,
      y: (evt.clientY - rect.top) / rect.height * WORLD.h
    }
  }

  function onPointerDown(evt){
    if(mode === 'menu') return
    const p = pointerToWorld(evt)
    const button = hitDiscoverButton(p)
    if(button === 'add'){
      addDiscoverGear()
      return
    }
    const gear = gearAt(p)
    if(mode === 'discover' && gear?.id === 'start'){
      toggleStartDirection()
      return
    }
    if(!gear || gear.fixed) return
    hasDraggedDiscover = mode === 'discover' ? true : hasDraggedDiscover
    canvas.setPointerCapture(evt.pointerId)
    disconnectGear(gear)
    drag = { id: gear.id, dx: p.x - gear.x, dy: p.y - gear.y, pointerId: evt.pointerId, startX: p.x, startY: p.y, moved: false }
    gears = gears.filter(g => g.id !== gear.id).concat(gear)
  }

  function onPointerMove(evt){
    const p = pointerToWorld(evt)
    if(!drag){
      const gear = gearAt(p)
      const button = hitDiscoverButton(p)
      const draggable = gear && !gear.fixed && (mode === 'discover' || mode === 'solve')
      canvas.style.cursor = button || (mode === 'discover' && gear?.id === 'start') ? 'pointer' : draggable ? 'grab' : 'default'
      return
    }
    const gear = getGear(drag.id)
    gear.stock = false
    gear.x = clamp(p.x - drag.dx, gear.outerRadius + 18, WORLD.w - gear.outerRadius - 18)
    gear.y = clamp(p.y - drag.dy, solveRackClearanceY(gear), WORLD.h - gear.outerRadius - 18)
    const movedDistance = Math.hypot(p.x - drag.startX, p.y - drag.startY)
    if(movedDistance > 8) drag.moved = true
    if(mode === 'discover' && !overTrash(p) && movedDistance > 90 && trySnap(gear)) drag = null
  }

  function onPointerUp(evt){
    if(!drag || drag.pointerId !== evt.pointerId) return
    const p = pointerToWorld(evt)
    const gear = getGear(drag.id)
    if(mode === 'discover' && overTrash(p)) removeGear(gear)
    else if(mode === 'solve' && !drag.moved) checkSolveState()
    else if(!trySnap(gear) && mode === 'solve') rebuildSolveLinks()
    drag = null
  }

  function isTargetGearPowered(){
    const target = getGear('target')
    return !!target && Math.abs(target.speed) > 0.001
  }

  function isSolveChainComplete(){
    const target = getGear('target')
    if(!target || !isTargetGearPowered()) return false
    const rackState = rackMeshState(target)
    return rackState.valid && drivenGearIds().has(target.id)
  }

  function checkSolveState(){
    if(mode !== 'solve') return
    const solved = isSolveChainComplete()
    if(solved && !levelComplete){
      levelComplete = true
      showFeedback('Gelukt!')
      nextBtn.hidden = false
    }
    if(!solved && levelComplete){
      levelComplete = false
      nextBtn.hidden = true
      feedback.classList.remove('show')
    }
  }

  function pointOnGear(angle, radius){ return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius } }
  function gearLineTo(path, angle, radius){ const p = pointOnGear(angle, radius); path.lineTo(p.x, p.y) }
  function gearCurveTo(path, controlAngle, controlRadius, angle, radius){
    const c = pointOnGear(controlAngle, controlRadius)
    const p = pointOnGear(angle, radius)
    path.quadraticCurveTo(c.x, c.y, p.x, p.y)
  }

  function buildGearPath(gear){
    const path = new Path2D()
    const pitch = TWO_PI / gear.teeth
    const start = gear.angle - pitch * .50
    const first = pointOnGear(start, gear.rootRadius)
    path.moveTo(first.x, first.y)
    for(let i = 0; i < gear.teeth; i++){
      const c = gear.angle + i * pitch
      const valleyLeft = c - pitch * .50
      const valleyFloorEnd = c - pitch * .38
      const leftShoulder = c - pitch * .24
      const topLeft = c - pitch * .12
      const topRight = c + pitch * .12
      const rightShoulder = c + pitch * .24
      const valleyFloorStart = c + pitch * .38
      const valleyRight = c + pitch * .50
      path.arc(0, 0, gear.rootRadius, valleyLeft, valleyFloorEnd, false)
      gearCurveTo(path, c - pitch * .28, gear.rootRadius + TOOTH_DEPTH * .20, leftShoulder, gear.pitchRadius + TOOTH_DEPTH * .04)
      gearCurveTo(path, c - pitch * .19, gear.outerRadius, topLeft, gear.outerRadius)
      path.arc(0, 0, gear.outerRadius, topLeft, topRight, false)
      gearCurveTo(path, c + pitch * .19, gear.outerRadius, rightShoulder, gear.pitchRadius + TOOTH_DEPTH * .04)
      gearCurveTo(path, c + pitch * .28, gear.rootRadius + TOOTH_DEPTH * .20, valleyFloorStart, gear.rootRadius)
      gearLineTo(path, valleyRight, gear.rootRadius)
    }
    path.closePath()
    return path
  }

  function drawGear(g){
    ctx.save()
    ctx.translate(g.x, g.y)
    const scale = 1 + g.pulse * .035
    ctx.scale(scale, scale)
    if(g.stock) ctx.globalAlpha = .94

    const path = buildGearPath(g)
    ctx.shadowColor = 'rgba(63,57,37,.25)'
    ctx.shadowBlur = 20
    ctx.shadowOffsetY = 8

    const grad = ctx.createRadialGradient(-g.pitchRadius * .36, -g.pitchRadius * .42, 5, 0, 0, g.outerRadius)
    grad.addColorStop(0, '#ffffff')
    grad.addColorStop(.16, g.accent)
    grad.addColorStop(.48, g.color)
    grad.addColorStop(.78, shade(g.color, -14))
    grad.addColorStop(1, shade(g.color, -34))
    ctx.fillStyle = grad
    ctx.fill(path)

    ctx.shadowColor = 'transparent'
    ctx.save()
    ctx.clip(path)

    const gloss = ctx.createLinearGradient(-g.outerRadius, -g.outerRadius, g.outerRadius, g.outerRadius)
    gloss.addColorStop(0, 'rgba(255,255,255,.34)')
    gloss.addColorStop(.36, 'rgba(255,255,255,.12)')
    gloss.addColorStop(.62, 'rgba(255,255,255,0)')
    gloss.addColorStop(1, 'rgba(80,45,30,.16)')
    ctx.fillStyle = gloss
    ctx.fillRect(-g.outerRadius, -g.outerRadius, g.outerRadius * 2, g.outerRadius * 2)

    ctx.strokeStyle = 'rgba(255,255,255,.42)'
    ctx.lineWidth = 7
    ctx.beginPath(); ctx.arc(0, 0, g.outerRadius - 4, Math.PI * 1.05, Math.PI * 1.92); ctx.stroke()
    ctx.strokeStyle = 'rgba(69,43,27,.14)'
    ctx.lineWidth = 8
    ctx.beginPath(); ctx.arc(0, 0, g.outerRadius - 6, Math.PI * .06, Math.PI * .82); ctx.stroke()
    ctx.restore()

    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.lineWidth = 5
    ctx.strokeStyle = 'rgba(69,43,27,.20)'
    ctx.stroke(path)
    ctx.lineWidth = 2
    ctx.strokeStyle = 'rgba(255,255,255,.52)'
    ctx.stroke(path)

    drawGearInnerDetails(g)
    if(g.id === 'start') drawStartDirectionArrow(g)
    ctx.restore()
  }

  function drawGearInnerDetails(g){
    const ringRadius = Math.max(g.boreRadius + 13, g.pitchRadius * .43)
    const hubRadius = Math.max(16, g.boreRadius * .78)

    ctx.save()
    ctx.lineWidth = 8
    ctx.strokeStyle = 'rgba(255,255,255,.25)'
    ctx.beginPath(); ctx.arc(0, 0, ringRadius + 5, 0, TWO_PI); ctx.stroke()
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(87,55,33,.18)'
    ctx.beginPath(); ctx.arc(0, 0, ringRadius, 0, TWO_PI); ctx.stroke()

    const hub = ctx.createRadialGradient(-hubRadius * .35, -hubRadius * .45, 2, 0, 0, hubRadius * 1.12)
    hub.addColorStop(0, 'rgba(255,255,255,.95)')
    hub.addColorStop(.32, g.accent)
    hub.addColorStop(.74, shade(g.color, -7))
    hub.addColorStop(1, shade(g.color, -24))
    ctx.fillStyle = hub
    ctx.beginPath(); ctx.arc(0, 0, hubRadius, 0, TWO_PI); ctx.fill()
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(87,55,33,.20)'
    ctx.stroke()

    ctx.fillStyle = 'rgba(255,255,255,.50)'
    ctx.beginPath(); ctx.ellipse(-hubRadius * .28, -hubRadius * .35, hubRadius * .28, hubRadius * .13, -.45, 0, TWO_PI); ctx.fill()
    ctx.restore()
  }

  function drawStartDirectionArrow(g){
    const clockwise = g.speed > 0
    const pulse = mode === 'discover' ? .5 + Math.sin(performance.now() / 360) * .5 : 0
    const arrowRadius = Math.max(g.boreRadius + 25, g.pitchRadius * .60)
    const startAngle = g.angle - Math.PI * .72
    const endAngle = g.angle + Math.PI * .82
    const from = clockwise ? startAngle : endAngle
    const to = clockwise ? endAngle : startAngle
    const anticlockwise = !clockwise
    if(mode === 'discover'){
      ctx.save(); ctx.globalAlpha = .16 + pulse * .10; ctx.strokeStyle = '#fff7a8'; ctx.lineWidth = 13
      ctx.beginPath(); ctx.arc(0, 0, g.outerRadius + 6 + pulse * 5, 0, TWO_PI); ctx.stroke(); ctx.restore()
    }
    const dir = clockwise ? 1 : -1
    const headLength = 22
    const headWidth = 23
    const headBaseAngle = to - dir * headLength / arrowRadius
    const tip = pointOnGear(to, arrowRadius)
    const base = pointOnGear(headBaseAngle, arrowRadius)
    const normal = headBaseAngle
    const outer = { x: base.x + Math.cos(normal) * headWidth * .5, y: base.y + Math.sin(normal) * headWidth * .5 }
    const inner = { x: base.x - Math.cos(normal) * headWidth * .5, y: base.y - Math.sin(normal) * headWidth * .5 }
    ctx.save()
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.shadowColor = 'rgba(47,92,45,.30)'; ctx.shadowBlur = 5
    ctx.lineWidth = 15; ctx.strokeStyle = 'rgba(47,92,45,.22)'
    ctx.beginPath(); ctx.arc(0, 0, arrowRadius, from, headBaseAngle, anticlockwise); ctx.stroke()
    ctx.fillStyle = 'rgba(47,92,45,.22)'; drawRoundedArrowHead(tip.x + 2, tip.y + 3, outer.x + 2, outer.y + 3, inner.x + 2, inner.y + 3); ctx.fill()
    ctx.shadowColor = 'transparent'; ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(255,255,255,.97)'
    ctx.beginPath(); ctx.arc(0, 0, arrowRadius, from, headBaseAngle, anticlockwise); ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,.98)'; drawRoundedArrowHead(tip.x, tip.y, outer.x, outer.y, inner.x, inner.y); ctx.fill()
    ctx.restore()
  }

  function drawRoundedArrowHead(tipX, tipY, outerX, outerY, innerX, innerY){
    ctx.beginPath(); ctx.moveTo(tipX, tipY)
    ctx.quadraticCurveTo((tipX + outerX) / 2, (tipY + outerY) / 2, outerX, outerY)
    ctx.quadraticCurveTo((outerX + innerX) / 2 - (tipX - (outerX + innerX) / 2) * .18, (outerY + innerY) / 2 - (tipY - (outerY + innerY) / 2) * .18, innerX, innerY)
    ctx.quadraticCurveTo((tipX + innerX) / 2, (tipY + innerY) / 2, tipX, tipY)
    ctx.closePath()
  }

  function shade(hex, percent){
    const num = parseInt(hex.slice(1), 16)
    const amt = Math.round(2.55 * percent)
    const r = clamp((num >> 16) + amt, 0, 255)
    const g = clamp((num >> 8 & 255) + amt, 0, 255)
    const b = clamp((num & 255) + amt, 0, 255)
    return `rgb(${r},${g},${b})`
  }

  function drawBackground(){
    const background = assets.background
    if(background.ready) ctx.drawImage(background, 0, 0, WORLD.w, WORLD.h)
    else {
      const sky = ctx.createLinearGradient(0, 0, 0, WORLD.h)
      sky.addColorStop(0, '#9fe4f2'); sky.addColorStop(1, '#f8d99b')
      ctx.fillStyle = sky; ctx.fillRect(0, 0, WORLD.w, WORLD.h)
    }
    ctx.fillStyle = 'rgba(122,82,43,.18)'; ctx.fillRect(0, 602, WORLD.w, 118)
    ctx.fillStyle = '#cf8847'; roundRect(130, 590, 1020, 54, 24); ctx.fill()
    ctx.fillStyle = 'rgba(91,55,29,.22)'
    for(let x = 165; x < 1120; x += 115) ctx.fillRect(x, 606, 54, 8)
    drawRobot()
  }

  function drawRobot(opts = {}){
    const large = !!opts.large
    const robotX = large ? 16 : -4
    const robotY = large ? 462 : 500
    const robotW = large ? 220 : 150
    const robotH = large ? 283 : 193
    if(assets.robot.ready){
      ctx.drawImage(assets.robot, robotX, robotY, robotW, robotH)
      const blinkOverlay = currentRobotBlinkOverlay()
      if(blinkOverlay?.ready) ctx.drawImage(blinkOverlay, robotX, robotY, robotW, robotH)
      return
    }
    ctx.save(); ctx.translate(45, 578)
    ctx.fillStyle = '#dde8ee'; roundRect(-55, 28, 130, 104, 24); ctx.fill()
    ctx.fillStyle = '#f3fbff'; roundRect(-35, 46, 88, 42, 16); ctx.fill()
    ctx.fillStyle = '#364756'; ctx.beginPath(); ctx.arc(-12, 68, 8, 0, TWO_PI); ctx.arc(30, 68, 8, 0, TWO_PI); ctx.fill()
    ctx.strokeStyle = '#6e8796'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(10, 28); ctx.lineTo(10, -6); ctx.stroke()
    ctx.fillStyle = '#ffcb4e'; ctx.beginPath(); ctx.arc(10, -12, 12, 0, TWO_PI); ctx.fill()
    ctx.fillStyle = '#91c3d2'; roundRect(-34, 132, 88, 80, 18); ctx.fill()
    ctx.fillStyle = '#ffb34d'; ctx.beginPath(); ctx.arc(10, 172, 19, 0, TWO_PI); ctx.fill()
    ctx.restore()
  }


  function currentRobotBlinkOverlay(){
    const cycle = performance.now() % 4600
    if(cycle < 3860) return null
    if(cycle < 3920) return assets.robotBlink1
    if(cycle < 4005) return assets.robotBlink2
    if(cycle < 4065) return assets.robotBlink1
    return null
  }

  function roundRect(x, y, w, h, r){
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
  }

  function drawDragHint(){
    if(mode !== 'discover' || hintAlpha <= 0) return
    const gear = getGear('blue')
    const start = getGear('start')
    if(!gear || !start) return
    const t = (performance.now() / 1700) % 1
    const hold = t < .18 ? 0 : t > .82 ? 1 : (t - .18) / .64
    const ease = hold < .5 ? 2 * hold * hold : 1 - Math.pow(-2 * hold + 2, 2) / 2
    const sx = gear.x - 18
    const sy = gear.y - 84
    const tx = start.x + start.outerRadius + gear.outerRadius + 26
    const ty = start.y - 24
    const x = sx + (tx - sx) * ease
    const y = sy + (ty - sy) * ease
    const alpha = hintAlpha * (.72 + Math.sin(t * TWO_PI) * .14)
    ctx.save(); ctx.globalAlpha = alpha
    ctx.strokeStyle = 'rgba(255,255,255,.78)'; ctx.lineWidth = 13; ctx.lineCap = 'round'; ctx.setLineDash([1, 24])
    ctx.beginPath(); ctx.moveTo(sx, sy + 12); ctx.lineTo(tx, ty + 12); ctx.stroke(); ctx.setLineDash([])
    ctx.fillStyle = 'rgba(255,246,207,.92)'; ctx.strokeStyle = 'rgba(112,71,28,.22)'; ctx.lineWidth = 4
    roundRect(x - 62, y - 92, 124, 42, 21); ctx.fill(); ctx.stroke()
    ctx.fillStyle = '#70471c'; ctx.font = '900 23px ui-rounded, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('sleep', x, y - 70)
    ctx.font = '72px ui-rounded, system-ui, sans-serif'; ctx.fillText('☝️', x, y)
    ctx.restore()
  }

  function drawDiscoverControls(){
    if(mode !== 'discover') return
    drawAddButton()
    drawTrashZone()
  }

  function drawAddButton(){
    const add = DISCOVER_UI.add
    const disabled = gears.length >= MAX_DISCOVER_GEARS
    ctx.save(); ctx.globalAlpha = disabled ? .48 : 1
    ctx.fillStyle = disabled ? 'rgba(210,196,171,.92)' : 'rgba(255,246,207,.95)'
    ctx.strokeStyle = disabled ? 'rgba(112,71,28,.14)' : 'rgba(112,71,28,.24)'; ctx.lineWidth = 5
    roundRect(add.x - add.size / 2, add.y - add.size / 2, add.size, add.size, 24); ctx.fill(); ctx.stroke()
    ctx.fillStyle = disabled ? '#9d8b72' : '#3f9f47'; ctx.font = '1000 56px ui-rounded, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('+', add.x, add.y - 3); ctx.restore()
  }

  function drawTrashZone(){
    const trash = DISCOVER_UI.trash
    const active = drag && overTrash({ x: getGear(drag.id)?.x || -999, y: getGear(drag.id)?.y || -999 })
    ctx.save(); ctx.fillStyle = active ? 'rgba(255,225,215,.96)' : 'rgba(255,246,207,.88)'
    ctx.strokeStyle = active ? 'rgba(214,81,56,.72)' : 'rgba(112,71,28,.20)'; ctx.lineWidth = active ? 7 : 5
    roundRect(trash.x - trash.size / 2, trash.y - trash.size / 2, trash.size, trash.size, 28); ctx.fill(); ctx.stroke()
    ctx.font = '54px ui-rounded, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🗑️', trash.x, trash.y + 1)
    ctx.restore()
  }

  function drawSolveStage(){
    if(mode !== 'solve') return
    drawStockTray()
    drawMachine()
  }

  function drawStockTray(){
    ctx.save()
    ctx.restore()
  }

  function drawMachine(){
    drawDoorMachineBase(doorProgress)
  }

  function drawLevel1RackAndBrackets(){
    drawLevel1Rack(doorProgress)
    drawLevel1Brackets()
  }

  function drawImageCover(img, x, y, w, h){
    if(!img.ready) return false
    ctx.drawImage(img, x, y, w, h)
    return true
  }

  function drawImageContained(img, x, y, w, h){
    if(!img.ready) return false
    ctx.drawImage(img, x, y, w, h)
    return true
  }

  function drawDoorMachineBase(t){
    const door = LEVEL_1_DOOR
    const travel = door.travel * t
    const panelX = door.panelClosedX - travel

    ctx.save()

    // 2. Vertrek achter de opening. De PNG heeft dezelfde canvasverhouding als de achtergrond.
    drawImageCover(assets.room, 0, 0, WORLD.w, WORLD.h)

    // 3. Eén schuifdeurpaneel. Het paneel schuift links achter de deurpost.
    ctx.save()
    ctx.beginPath()
    ctx.rect(door.panelClosedX - door.travel - 8, door.panelY - 10, door.panelW + door.travel + 18, door.panelH + 18)
    ctx.clip()
    if(!drawImageContained(assets.slidingDoor, panelX, door.panelY, door.panelW, door.panelH)){
      ctx.fillStyle = '#126ed3'
      roundRect(panelX, door.panelY, door.panelW, door.panelH, 16); ctx.fill()
    }
    ctx.restore()

    // 3. Vast deurframe bovenop de schuifdeur, zodat de deur achter de deurpost verdwijnt.
    drawLevel1BackgroundFrame()

    ctx.restore()
  }

  function drawLevel1BackgroundFrame(){
    if(assets.level1Background.ready) ctx.drawImage(assets.level1Background, 0, 0, WORLD.w, WORLD.h)
    else drawLevel1FrameOverlay()
  }

  function drawLevel1Rack(t){
    const door = LEVEL_1_DOOR
    const rackX = rackXForProgress(t)
    ctx.save()
    ctx.translate(rackX, door.rackY)
    drawLevel1MeshedRack(door.rackW, door.rackH, RACK_TOOTH_PHASE)
    ctx.restore()
  }

  function drawLevel1Brackets(){
    LEVEL_1_DOOR.brackets.forEach(bracket => {
      if(!drawImageContained(assets.bracket, bracket.x, bracket.y, bracket.w, bracket.h)){
        ctx.fillStyle = '#6f7982'
        roundRect(bracket.x, bracket.y, bracket.w, bracket.h, 8); ctx.fill()
      }
    })
  }

  function drawLevel1FrameOverlay(){
    const overlay = LEVEL_1_DOOR.frameOverlay
    if(!assets.level1Background.ready) return
    const strips = [
      { x: overlay.x, y: overlay.y, w: overlay.w, h: overlay.openingY - overlay.y },
      { x: overlay.x, y: overlay.openingY, w: overlay.openingX - overlay.x, h: overlay.openingH },
      { x: overlay.openingX + overlay.openingW, y: overlay.openingY, w: overlay.x + overlay.w - overlay.openingX - overlay.openingW, h: overlay.openingH },
      { x: overlay.x, y: overlay.openingY + overlay.openingH, w: overlay.w, h: overlay.y + overlay.h - overlay.openingY - overlay.openingH }
    ]
    strips.forEach(strip => {
      if(strip.w <= 0 || strip.h <= 0) return
      const sx = strip.x / WORLD.w * assets.level1Background.width
      const sy = strip.y / WORLD.h * assets.level1Background.height
      const sw = strip.w / WORLD.w * assets.level1Background.width
      const sh = strip.h / WORLD.h * assets.level1Background.height
      ctx.drawImage(assets.level1Background, sx, sy, sw, sh, strip.x, strip.y, strip.w, strip.h)
    })
  }

  function drawLevel1MeshedRack(width, height, phase){
    const bodyH = 19
    const pitch = TOOTH_PITCH
    const rootInset = 4
    const toothTopW = pitch * .66
    const toothBottomW = pitch * .46
    const toothH = height - bodyH - rootInset
    const toothHalf = toothTopW / 2
    const endInset = 8
    const firstToothX = phase + Math.ceil((toothHalf + endInset - phase) / pitch) * pitch

    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, width, height)
    ctx.clip()

    ctx.fillStyle = '#d8a350'
    roundRect(0, 0, width, bodyH + 5, 7); ctx.fill()

    const bodyGrad = ctx.createLinearGradient(0, 0, 0, bodyH + 5)
    bodyGrad.addColorStop(0, '#f0c36c')
    bodyGrad.addColorStop(.45, '#d8a350')
    bodyGrad.addColorStop(1, '#b9782b')
    ctx.fillStyle = bodyGrad
    roundRect(0, 0, width, bodyH + 5, 7); ctx.fill()

    ctx.fillStyle = 'rgba(106,63,24,.20)'
    ctx.fillRect(0, bodyH + 1, width, 5)

    for(let x = firstToothX; x <= width - toothHalf - endInset; x += pitch){
      drawRoundedRackTooth(x, bodyH - 1, toothTopW, toothBottomW, toothH + 1, 5)
      const toothGrad = ctx.createLinearGradient(0, bodyH - 1, 0, height - rootInset)
      toothGrad.addColorStop(0, '#e5b45f')
      toothGrad.addColorStop(.62, '#d49a48')
      toothGrad.addColorStop(1, '#bd7c31')
      ctx.fillStyle = toothGrad
      ctx.fill()
      ctx.strokeStyle = 'rgba(103,65,28,.24)'
      ctx.lineWidth = 3
      ctx.stroke()
      ctx.strokeStyle = 'rgba(255,255,255,.26)'
      ctx.lineWidth = 1.5
      ctx.stroke()
    }

    ctx.strokeStyle = 'rgba(103,65,28,.24)'
    ctx.lineWidth = 3
    roundRect(0, 0, width, height, 7); ctx.stroke()
    ctx.strokeStyle = 'rgba(255,255,255,.38)'
    ctx.lineWidth = 3
    ctx.beginPath(); ctx.moveTo(10, 6); ctx.lineTo(width - 10, 6); ctx.stroke()
    ctx.restore()
  }

  function drawRoundedRackTooth(cx, y, topW, bottomW, h, r){
    const topLeft = cx - topW / 2
    const topRight = cx + topW / 2
    const bottomRight = cx + bottomW / 2
    const bottomLeft = cx - bottomW / 2
    const bottomY = y + h
    ctx.beginPath()
    ctx.moveTo(topLeft + r, y)
    ctx.lineTo(topRight - r, y)
    ctx.quadraticCurveTo(topRight, y, topRight, y + r)
    ctx.lineTo(bottomRight, bottomY - r)
    ctx.quadraticCurveTo(bottomRight, bottomY, bottomRight - r, bottomY)
    ctx.lineTo(bottomLeft + r, bottomY)
    ctx.quadraticCurveTo(bottomLeft, bottomY, bottomLeft, bottomY - r)
    ctx.lineTo(topLeft, y + r)
    ctx.quadraticCurveTo(topLeft, y, topLeft + r, y)
    ctx.closePath()
  }

  function drawFallbackRack(width, height){
    drawLevel1MeshedRack(width, height, RACK_TOOTH_PHASE)
  }

  function drawLampMachine(t){
    ctx.save(); ctx.translate(920, 262)
    ctx.strokeStyle = '#6d4a35'; ctx.lineWidth = 14; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 180); ctx.lineTo(0, 70); ctx.stroke()
    ctx.fillStyle = '#6d4a35'; roundRect(-46, 174, 92, 26, 13); ctx.fill()
    ctx.fillStyle = t > .2 ? `rgba(255,230,83,${.22 + t * .45})` : 'rgba(255,230,83,.04)'
    ctx.beginPath(); ctx.arc(0, 46, 96 + t * 12, 0, TWO_PI); ctx.fill()
    ctx.fillStyle = t > .2 ? '#ffe45c' : '#b9c4c9'; ctx.beginPath(); ctx.arc(0, 45, 48, 0, TWO_PI); ctx.fill()
    ctx.fillStyle = '#f7fbff'; ctx.beginPath(); ctx.ellipse(-16, 26, 15, 10, -.5, 0, TWO_PI); ctx.fill()
    ctx.restore()
  }

  function drawBridgeMachine(t){
    ctx.save(); ctx.translate(935, 380)
    ctx.fillStyle = '#6a7d86'; roundRect(-24, 90, 58, 64, 10); ctx.fill(); roundRect(182, 90, 58, 64, 10); ctx.fill()
    ctx.save(); ctx.translate(12, 92); ctx.rotate(-.85 * (1 - t))
    ctx.fillStyle = '#c98445'; roundRect(0, -26, 206, 52, 12); ctx.fill()
    ctx.fillStyle = 'rgba(91,55,29,.22)'; for(let x = 22; x < 190; x += 42) ctx.fillRect(x, -22, 10, 44)
    ctx.restore()
    ctx.fillStyle = '#70c7e7'; ctx.fillRect(-58, 142, 338, 38)
    ctx.restore()
  }

  function drawEffects(dt){
    clickEffects.forEach(e => e.age += dt)
    clickEffects = clickEffects.filter(e => e.age < .55)
    clickEffects.forEach(e => {
      const t = e.age / .55
      ctx.save(); ctx.globalAlpha = 1 - t; ctx.strokeStyle = '#fff7a8'; ctx.lineWidth = 8 * (1 - t)
      ctx.beginPath(); ctx.arc(e.x, e.y, 42 + t * 44, 0, TWO_PI); ctx.stroke(); ctx.restore()
    })
  }


  function drawDebugMesh(){
    if(!DEBUG_MESH || mode !== 'solve') return
    const target = getGear('target')
    ctx.save()
    ctx.lineWidth = 2
    gears.filter(g => !g.stock).forEach(g => {
      ctx.strokeStyle = g.target ? 'rgba(236,111,174,.85)' : 'rgba(69,181,232,.75)'
      ctx.setLineDash([8, 6])
      ctx.beginPath(); ctx.arc(g.x, g.y, g.pitchRadius, 0, TWO_PI); ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = 'rgba(255,255,255,.9)'
      ctx.beginPath(); ctx.arc(g.x, g.y, 4, 0, TWO_PI); ctx.fill()
    })

    const debugLinks = debugMeshLinks.length ? debugMeshLinks : links.map(link => ({ ...link, valid:true }))
    debugLinks.forEach(link => {
      const a = getGear(link.a)
      const b = getGear(link.b)
      if(!a || !b) return
      const valid = !!link.valid
      const angle = Math.atan2(b.y - a.y, b.x - a.x)
      const contact = {
        x: a.x + Math.cos(angle) * a.pitchRadius,
        y: a.y + Math.sin(angle) * a.pitchRadius
      }
      ctx.strokeStyle = valid ? 'rgba(67,190,95,.9)' : 'rgba(229,62,62,.9)'
      ctx.lineWidth = 3
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
      ctx.fillStyle = valid ? '#43be5f' : '#e53e3e'
      ctx.beginPath(); ctx.arc(contact.x, contact.y, 6, 0, TWO_PI); ctx.fill()
    })

    const pitchY = rackPitchLineY()
    ctx.strokeStyle = 'rgba(255,214,77,.95)'
    ctx.lineWidth = 3
    ctx.setLineDash([10, 7])
    ctx.beginPath(); ctx.moveTo(rackXForProgress(), pitchY); ctx.lineTo(rackXForProgress() + LEVEL_1_DOOR.rackW, pitchY); ctx.stroke()
    ctx.setLineDash([])

    if(target){
      const rackState = debugRackState || rackMeshState(target)
      const contact = rackState.contact || { x: target.x, y: pitchY }
      ctx.fillStyle = rackState.valid ? '#43be5f' : '#e53e3e'
      ctx.beginPath(); ctx.arc(contact.x, contact.y, 7, 0, TWO_PI); ctx.fill()
      ctx.font = '800 16px ui-rounded, system-ui, sans-serif'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'bottom'
      ctx.fillText(rackState.valid ? 'rack mesh OK' : `rack mesh fout ${rackState.gapError.toFixed(1)}px`, contact.x + 12, contact.y - 8)
    }
    ctx.restore()
  }

  function render(dt){
    if(mode === 'solve'){
      drawMachine()
      drawRobot({ large: true })
      gears.filter(g => !g.stock).forEach(drawGear)
      drawLevel1RackAndBrackets()
      drawDebugMesh()
      drawStockTray()
      gears.filter(g => g.stock).forEach(drawGear)
    } else {
      drawBackground()
      drawSolveStage()
      gears.forEach(drawGear)
    }
    drawDiscoverControls()
    drawDragHint()
    drawEffects(dt)
  }

  function syncSolveGearRotationWithRack(progressDelta, dt){
    if(mode !== 'solve') return
    gears.forEach(g => { g.rotationSpeed = g.speed })

    const target = getGear('target')
    if(!target) return

    const queue = [target]
    const linkedToRack = new Set([target.id])
    while(queue.length){
      const gear = queue.shift()
      connectedTo(gear.id).forEach(nextId => {
        const next = getGear(nextId)
        if(!next || linkedToRack.has(next.id)) return
        linkedToRack.add(next.id)
        queue.push(next)
      })
    }

    if(Math.abs(progressDelta) < 0.000001 || dt <= 0){
      linkedToRack.forEach(id => {
        const gear = getGear(id)
        if(gear) gear.rotationSpeed = 0
      })
      return
    }

    const rackLinearSpeed = progressDelta * LEVEL_1_RACK_TRAVEL / dt
    target.rotationSpeed = -rackLinearSpeed / target.pitchRadius
    queue.push(target)
    const synced = new Set([target.id])
    while(queue.length){
      const gear = queue.shift()
      connectedTo(gear.id).forEach(nextId => {
        const next = getGear(nextId)
        if(!next || synced.has(next.id)) return
        next.rotationSpeed = -gear.rotationSpeed * gear.teeth / next.teeth
        synced.add(next.id)
        queue.push(next)
      })
    }
  }

  function updateSolveMachine(dt){
    const target = getGear('target')
    const moving = mode === 'solve' && target && isSolveChainComplete()
    const previousProgress = doorProgress
    if(moving){
      const linearRackSpeed = -target.speed * target.pitchRadius
      doorProgress = clamp(doorProgress + linearRackSpeed * dt / LEVEL_1_RACK_TRAVEL, 0, 1)
    } else {
      doorProgress = clamp(doorProgress - dt * .55, 0, 1)
    }
    syncSolveGearRotationWithRack(doorProgress - previousProgress, dt)
    machineProgress = doorProgress
  }

  function update(dt){
    updateSolveMachine(dt)
    gears.forEach(g => {
      const rotationSpeed = mode === 'solve' ? g.rotationSpeed : g.speed
      if(!drag || drag.id !== g.id) g.angle += rotationSpeed * dt
      g.pulse = Math.max(0, g.pulse - dt * 2.8)
    })
    hintAlpha = hasDraggedDiscover ? Math.max(0, hintAlpha - dt * 2.6) : Math.min(1, hintAlpha + dt * 1.4)
  }

  function loop(now){
    const dt = Math.min(.05, (now - lastTime) / 1000)
    lastTime = now
    update(dt)
    render(dt)
    requestAnimationFrame(loop)
  }

  function resize(){
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = WORLD.w * dpr
    canvas.height = WORLD.h * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  function showFeedback(text){
    feedback.textContent = text
    feedback.classList.add('show')
    clearTimeout(showFeedback.timer)
    showFeedback.timer = setTimeout(() => {
      if(!levelComplete) feedback.classList.remove('show')
    }, 700)
  }

  menuDiscoverBtn.addEventListener('click', startDiscover)
  menuSolveBtn.addEventListener('click', startSolveLevel1)
  backBtn.addEventListener('click', showMenu)
  resetBtn.addEventListener('click', resetSolveLevel1)
  nextBtn.addEventListener('click', () => {
    // Level 1 is the only solve level for now. Keep the button friendly but inactive.
    showFeedback('Gelukt!')
  })
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)
  window.addEventListener('resize', resize, { passive:true })

  resize()
  showMenu()
  requestAnimationFrame(loop)
})()
