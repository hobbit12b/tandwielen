(() => {
  const canvas = document.getElementById('gameCanvas')
  const ctx = canvas.getContext('2d')
  const discoverBtn = document.getElementById('discoverBtn')
  const chooseBtn = document.getElementById('chooseBtn')
  const choosePanel = document.getElementById('choosePanel')
  const leftBtn = document.getElementById('leftBtn')
  const rightBtn = document.getElementById('rightBtn')
  const feedback = document.getElementById('feedback')

  const WORLD = { w: 1280, h: 720 }
  const TOOTH_PITCH = 36 // vaste lineaire afstand tussen tanden op de pitch-cirkel
  const TOOTH_DEPTH = 32
  const TOOTH_ADDENDUM = TOOTH_DEPTH * 0.40
  const TOOTH_DEDENDUM = TOOTH_DEPTH * 0.60
  const MESH_TOOTH_OVERLAP = -3
  const SNAP_TOLERANCE = 50
  const LINK_DISTANCE_TOLERANCE = 12
  const VISUAL_COLLISION_PADDING = 0
  const CONTACT_LINE_PADDING = 4
  const START_SPEED = 0.34 // rustig ontdekspeelgoed, geen arcade-snelheid
  const MAX_DISCOVER_GEARS = 10
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
  const TWO_PI = Math.PI * 2

  const assets = loadImages({
    background: 'assets/background.png',
    robot: 'assets/robot.png',
    gear01: 'assets/gear01.png',
    gear02: 'assets/gear02.png',
    gear03: 'assets/gear03.png',
    gear04: 'assets/gear04.png',
    question: 'assets/gear_question.png'
  })

  let mode = 'discover'
  let gears = []
  let links = []
  let drag = null
  let lastTime = performance.now()
  let clickEffects = []
  let chooseQuestion = null
  let hasDraggedDiscover = false
  let hintAlpha = 1
  let nextDiscoverGearIndex = 0

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
  function visualCollisionRadius(gear){ return gear.pitchRadius + VISUAL_COLLISION_PADDING }

  function gearRadii(teeth){
    // Alle tandwielen gebruiken dezelfde tandsteek. Daardoor groeit de pitch-radius
    // lineair met het aantal tanden en blijven grote/kleine tandwielen logisch grijpen.
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
      accent: opts.accent || '#ffffff',
      fixed: !!opts.fixed,
      driver: !!opts.driver,
      target: !!opts.target,
      angle: opts.angle || 0,
      speed: opts.speed || 0,
      pulse: 0,
      ...radii
    }
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

  function resetChoose(){
    const driverTeeth = [10, 12, 14][Math.floor(Math.random() * 3)]
    const targetTeeth = [10, 12, 16][Math.floor(Math.random() * 3)]
    const driverSpeed = START_SPEED * (Math.random() < 0.5 ? 1 : -1)
    const driver = makeGear('choose-driver', 500, 355, driverTeeth, '#59c765', { fixed:true, driver:true, speed:driverSpeed, accent:'#dff6a8' })
    const target = makeGear('choose-target', 0, 0, targetTeeth, '#8261d4', { fixed:true, target:true, accent:'#e5dcff' })
    const line = nearestValleyAngle(driver, Math.random() * TWO_PI)
    const distance = meshDistance(driver, target)
    target.x = driver.x + Math.cos(line) * distance
    target.y = driver.y + Math.sin(line) * distance
    phaseGearForMesh(driver, target, line)
    gears = [driver, target]
    links = [{ a: driver.id, b: target.id }]
    propagateRotation()
    chooseQuestion = { answer: Math.sign(target.speed) }
  }

  function setMode(next){
    mode = next
    discoverBtn.classList.toggle('active', mode === 'discover')
    chooseBtn.classList.toggle('active', mode === 'choose')
    syncChoosePanelVisibility()
    drag = null
    if(mode === 'discover') resetDiscover()
    else resetChoose()
  }

  function syncChoosePanelVisibility(){
    if(mode === 'discover'){
      choosePanel.hidden = true
      choosePanel.style.display = 'none'
      choosePanel.classList.remove('is-visible')
      return
    }
    if(mode === 'choose'){
      choosePanel.hidden = false
      choosePanel.style.display = ''
      choosePanel.classList.add('is-visible')
    }
  }

  function getGear(id){ return gears.find(g => g.id === id) }
  function connectedTo(id){
    return links.flatMap(l => l.a === id ? [l.b] : l.b === id ? [l.a] : [])
  }

  function propagateRotation(){
    // Draairichting verspreidt door het netwerk: buren draaien tegengesteld en
    // de snelheid volgt uit gelijke tangentiële snelheid op de pitch-cirkels.
    gears.forEach(g => { if(!g.driver) g.speed = 0 })
    const queue = gears.filter(g => g.driver)
    const seen = new Set(queue.map(g => g.id))
    while(queue.length){
      const gear = queue.shift()
      connectedTo(gear.id).forEach(nextId => {
        const next = getGear(nextId)
        if(!next || seen.has(next.id)) return
        next.speed = -gear.speed * gear.teeth / next.teeth
        seen.add(next.id)
        queue.push(next)
      })
    }
  }

  function disconnectGear(gear){
    if(!gear || gear.driver) return

    // Knip alleen op het aangrijppunt van het opgepakte wiel. Eerst bepalen we
    // welke buren zonder dit wiel nog bij het groene startwiel horen; die links
    // zijn de ouder-links richting de draaiende startketting. Child-links worden
    // ook netjes losgemaakt, zodat het opgepakte wiel vrij kan slepen zonder dat
    // afhankelijke tandwielen op afstand logisch gekoppeld blijven.
    const startSideIds = collectDriverSideIds(gear.id)
    const hadParentLink = links.some(l => (l.a === gear.id && startSideIds.has(l.b)) || (l.b === gear.id && startSideIds.has(l.a)))

    links = links.filter(l => l.a !== gear.id && l.b !== gear.id)
    if(hadParentLink) gear.speed = 0
    propagateRotation()
  }

  function collectDriverSideIds(blockedId){
    const queue = gears.filter(g => g.driver && g.id !== blockedId).map(g => g.id)
    const seen = new Set(queue)
    while(queue.length){
      const id = queue.shift()
      links.forEach(link => {
        const next = link.a === id ? link.b : link.b === id ? link.a : null
        if(!next || next === blockedId || seen.has(next)) return
        seen.add(next)
        queue.push(next)
      })
    }
    return seen
  }


  function toggleStartDirection(){
    const start = getGear('start')
    if(!start) return
    start.speed = -start.speed || START_SPEED
    propagateRotation()
    popClick(start.x, start.y, start)
  }

  function meshDistance(a, b){
    // De hartafstand krijgt een paar pixels extra lucht zodat afgeronde tandtoppen
    // niet zichtbaar door elkaar lopen, maar nog wel in de ruime opening lijken te vallen.
    return a.pitchRadius + b.pitchRadius - MESH_TOOTH_OVERLAP
  }

  function nearestValleyAngle(anchor, angle){
    const pitchAngle = TWO_PI / anchor.teeth
    // Valleien liggen precies halverwege twee tandtoppen van het vaste wiel.
    const valleyIndex = Math.round((normAngle(angle - anchor.angle) / pitchAngle) - 0.5)
    return anchor.angle + (valleyIndex + 0.5) * pitchAngle
  }

  function phaseGearForMesh(anchor, loose, meshAngle){
    const anchorPitch = TWO_PI / anchor.teeth
    const loosePitch = TWO_PI / loose.teeth
    const anchorValley = Math.round((meshAngle - anchor.angle) / anchorPitch - .5) + .5
    const looseTooth = Math.round((meshAngle + Math.PI - loose.angle) / loosePitch)
    // Koppel de fase aan de tandsteek van beide wielen. Zo staat op de
    // contactlijn telkens een tandtop tegenover een vallei en blijft die relatie
    // behouden wanneer propagateRotation de tegengestelde snelheden instelt.
    loose.angle = meshAngle + Math.PI - looseTooth * loosePitch
    anchor.angle = meshAngle - anchorValley * anchorPitch
  }

  function wouldOverlapAnyGear(candidateGear, ignoredGearIds = []){
    const ignored = new Set(ignoredGearIds)
    return gears.some(other => {
      if(other.id === candidateGear.id || ignored.has(other.id)) return false
      const minDistance = visualCollisionRadius(candidateGear) + visualCollisionRadius(other)
      return dist(candidateGear, other) < minDistance
    })
  }

  function distanceToSegment(p, a, b){
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lenSq = dx * dx + dy * dy
    if(lenSq === 0) return { distance: dist(p, a), t: 0 }
    const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq, 0, 1)
    const x = a.x + dx * t
    const y = a.y + dy * t
    return { distance: Math.hypot(p.x - x, p.y - y), t }
  }

  function isContactBlocked(anchor, loose){
    const endpointClearance = Math.min(anchor.pitchRadius, loose.pitchRadius) * .45
    const contactDistance = dist(anchor, loose)
    return gears.some(other => {
      if(other.id === anchor.id || other.id === loose.id) return false
      const hit = distanceToSegment(other, anchor, loose)
      const distanceFromAnchor = hit.t * contactDistance
      const distanceFromLoose = (1 - hit.t) * contactDistance
      if(distanceFromAnchor < endpointClearance || distanceFromLoose < endpointClearance) return false
      return hit.distance < visualCollisionRadius(other) + CONTACT_LINE_PADDING
    })
  }

  function isValidLink(anchor, loose){
    const wanted = meshDistance(anchor, loose)
    if(Math.abs(dist(anchor, loose) - wanted) > LINK_DISTANCE_TOLERANCE) return false
    if(isContactBlocked(anchor, loose)) return false
    if(wouldOverlapAnyGear(anchor, [loose.id]) || wouldOverlapAnyGear(loose, [anchor.id])) return false
    return true
  }

  function validateLinks(){
    const before = links.length
    links = links.filter(link => {
      const a = getGear(link.a)
      const b = getGear(link.b)
      return a && b && isValidLink(a, b)
    })
    if(links.length !== before) propagateRotation()
  }

  function trySnap(gear){
    if(mode !== 'discover') return false
    validateLinks()
    const candidates = gears
      .filter(g => g.id !== gear.id && Math.abs(g.speed) > 0.001)
      .map(anchor => {
        const wanted = meshDistance(anchor, gear)
        const d = dist(anchor, gear)
        const error = Math.abs(d - wanted)
        return { anchor, error, d }
      })
      .filter(candidate => candidate.error < SNAP_TOLERANCE)
      .sort((a, b) => a.error - b.error)

    for(const candidate of candidates){
      const rawAngle = Math.atan2(gear.y - candidate.anchor.y, gear.x - candidate.anchor.x)
      const meshAngle = nearestValleyAngle(candidate.anchor, rawAngle)
      const wanted = meshDistance(candidate.anchor, gear)
      const snappedGear = {
        ...gear,
        x: candidate.anchor.x + Math.cos(meshAngle) * wanted,
        y: candidate.anchor.y + Math.sin(meshAngle) * wanted
      }

      if(wouldOverlapAnyGear(snappedGear, [candidate.anchor.id])) continue
      if(isContactBlocked(candidate.anchor, snappedGear)) continue

      removeLinksForGear(gear.id)
      gear.x = snappedGear.x
      gear.y = snappedGear.y
      phaseGearForMesh(candidate.anchor, gear, meshAngle)
      links.push({ a: candidate.anchor.id, b: gear.id })
      validateLinks()
      propagateRotation()
      popClick(gear.x, gear.y, gear)
      return true
    }

    return false
  }

  function removeLinksForGear(id){
    links = links.filter(l => l.a !== id && l.b !== id)
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
    if(!best) best = { x: 940, y: 180 }
    const gear = makeGear(`extra-${Date.now()}-${nextDiscoverGearIndex}`, best.x, best.y, variant.teeth, variant.color, {
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
    if(!gear || gear.fixed || mode !== 'discover') return
    hasDraggedDiscover = true
    canvas.setPointerCapture(evt.pointerId)
    disconnectGear(gear)
    drag = { id: gear.id, dx: p.x - gear.x, dy: p.y - gear.y, pointerId: evt.pointerId, startX: p.x, startY: p.y }
    gears = gears.filter(g => g.id !== gear.id).concat(gear)
  }

  function onPointerMove(evt){
    const p = pointerToWorld(evt)
    if(!drag){
      const gear = gearAt(p)
      const button = hitDiscoverButton(p)
      canvas.style.cursor = button || (mode === 'discover' && gear?.id === 'start') ? 'pointer' : mode === 'discover' && gear && !gear.fixed ? 'grab' : 'default'
      return
    }
    const gear = getGear(drag.id)
    gear.x = clamp(p.x - drag.dx, gear.outerRadius + 18, WORLD.w - gear.outerRadius - 18)
    gear.y = clamp(p.y - drag.dy, 126 + gear.outerRadius, WORLD.h - gear.outerRadius - 18)
    if(!overTrash(p) && Math.hypot(p.x - drag.startX, p.y - drag.startY) > 90 && trySnap(gear)) drag = null
  }

  function onPointerUp(evt){
    if(!drag || drag.pointerId !== evt.pointerId) return
    const p = pointerToWorld(evt)
    const gear = getGear(drag.id)
    if(overTrash(p)) removeGear(gear)
    else trySnap(gear)
    drag = null
  }

  function pointOnGear(angle, radius){
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
  }

  function gearLineTo(path, angle, radius){
    const p = pointOnGear(angle, radius)
    path.lineTo(p.x, p.y)
  }

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
      // Eén tand bestaat uit een brede, bijna rechte top, twee zachte flanken en
      // een diepe afgeronde valley. De top gebruikt veel van de tandsteek, zodat
      // groep-3 leerlingen duidelijk een bloktand in een opening zien vallen.
      const valleyLeft = c - pitch * .50
      const valleyFloorEnd = c - pitch * .38
      const leftShoulder = c - pitch * .24
      const topLeft = c - pitch * .12
      const topRight = c + pitch * .12
      const rightShoulder = c + pitch * .24
      const valleyFloorStart = c + pitch * .38
      const valleyRight = c + pitch * .50

      // Afgeronde bodem tussen twee tanden: een root-radius boog in plaats van
      // een V-punt. Dit maakt de opening breed en mechanisch leesbaar.
      path.arc(0, 0, gear.rootRadius, valleyLeft, valleyFloorEnd, false)

      // Linkerflank: zacht gebogen van root naar buiten, met een afgeronde hoek
      // naar de brede tooth top.
      gearCurveTo(path, c - pitch * .28, gear.rootRadius + TOOTH_DEPTH * .20, leftShoulder, gear.pitchRadius + TOOTH_DEPTH * .04)
      gearCurveTo(path, c - pitch * .19, gear.outerRadius, topLeft, gear.outerRadius)

      // Brede afgeronde tooth top. Omdat dit een outer-radius boog is, blijft de
      // tand stomp en glossy in plaats van stekelig of zaagtandvormig.
      path.arc(0, 0, gear.outerRadius, topLeft, topRight, false)

      // Rechterflank terug naar de volgende diepe valley.
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

    ctx.shadowColor = 'rgba(63,57,37,.24)'
    ctx.shadowBlur = 18
    ctx.shadowOffsetY = 8
    const path = buildGearPath(g)
    const grad = ctx.createRadialGradient(-g.pitchRadius * .35, -g.pitchRadius * .45, 8, 0, 0, g.outerRadius)
    grad.addColorStop(0, '#ffffff')
    grad.addColorStop(.18, g.accent)
    grad.addColorStop(.52, g.color)
    grad.addColorStop(1, shade(g.color, -28))
    ctx.fillStyle = grad
    ctx.fill(path)
    ctx.shadowColor = 'transparent'
    ctx.lineWidth = 4
    ctx.strokeStyle = 'rgba(89,62,36,.22)'
    ctx.stroke(path)

    ctx.setLineDash([6, 9])
    ctx.lineWidth = 1.5
    ctx.strokeStyle = 'rgba(255,255,255,.46)'
    ctx.beginPath()
    ctx.arc(0, 0, g.pitchRadius, 0, TWO_PI)
    ctx.stroke()
    ctx.setLineDash([])

    ctx.fillStyle = 'rgba(92,63,46,.22)'
    ctx.beginPath(); ctx.arc(0, 0, g.boreRadius + 9, 0, TWO_PI); ctx.fill()
    const hole = ctx.createRadialGradient(-8, -10, 3, 0, 0, g.boreRadius + 7)
    hole.addColorStop(0, '#fff7d9')
    hole.addColorStop(.55, '#c79453')
    hole.addColorStop(1, '#6d4a35')
    ctx.fillStyle = hole
    ctx.beginPath(); ctx.arc(0, 0, g.boreRadius, 0, TWO_PI); ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,.58)'
    ctx.beginPath(); ctx.ellipse(-g.pitchRadius * .25, -g.pitchRadius * .36, g.pitchRadius * .22, 9, -.45, 0, TWO_PI); ctx.fill()
    if(g.id === 'start') drawStartDirectionArrow(g)
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
      ctx.save()
      ctx.globalAlpha = .16 + pulse * .10
      ctx.strokeStyle = '#fff7a8'
      ctx.lineWidth = 13
      ctx.beginPath(); ctx.arc(0, 0, g.outerRadius + 6 + pulse * 5, 0, TWO_PI); ctx.stroke()
      ctx.restore()
    }

    const dir = clockwise ? 1 : -1
    const headLength = 22
    const headWidth = 23
    const headBaseAngle = to - dir * headLength / arrowRadius
    const tip = pointOnGear(to, arrowRadius)
    const base = pointOnGear(headBaseAngle, arrowRadius)
    const normal = headBaseAngle
    const outer = {
      x: base.x + Math.cos(normal) * headWidth * .5,
      y: base.y + Math.sin(normal) * headWidth * .5
    }
    const inner = {
      x: base.x - Math.cos(normal) * headWidth * .5,
      y: base.y - Math.sin(normal) * headWidth * .5
    }

    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.shadowColor = 'rgba(47,92,45,.30)'
    ctx.shadowBlur = 5
    ctx.lineWidth = 15
    ctx.strokeStyle = 'rgba(47,92,45,.22)'
    ctx.beginPath(); ctx.arc(0, 0, arrowRadius, from, headBaseAngle, anticlockwise); ctx.stroke()
    ctx.fillStyle = 'rgba(47,92,45,.22)'
    drawRoundedArrowHead(tip.x + 2, tip.y + 3, outer.x + 2, outer.y + 3, inner.x + 2, inner.y + 3)
    ctx.fill()

    ctx.shadowColor = 'transparent'
    ctx.lineWidth = 10
    ctx.strokeStyle = 'rgba(255,255,255,.97)'
    ctx.beginPath(); ctx.arc(0, 0, arrowRadius, from, headBaseAngle, anticlockwise); ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,.98)'
    drawRoundedArrowHead(tip.x, tip.y, outer.x, outer.y, inner.x, inner.y)
    ctx.fill()
    ctx.restore()
  }

  function drawRoundedArrowHead(tipX, tipY, outerX, outerY, innerX, innerY){
    ctx.beginPath()
    ctx.moveTo(tipX, tipY)
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
    if(assets.background.ready) ctx.drawImage(assets.background, 0, 0, WORLD.w, WORLD.h)
    else {
      const sky = ctx.createLinearGradient(0, 0, 0, WORLD.h)
      sky.addColorStop(0, '#9fe4f2'); sky.addColorStop(1, '#f8d99b')
      ctx.fillStyle = sky; ctx.fillRect(0, 0, WORLD.w, WORLD.h)
    }
    ctx.fillStyle = 'rgba(122,82,43,.18)'
    ctx.fillRect(0, 602, WORLD.w, 118)
    ctx.fillStyle = '#cf8847'
    roundRect(130, 590, 1020, 54, 24); ctx.fill()
    ctx.fillStyle = 'rgba(91,55,29,.22)'
    for(let x = 165; x < 1120; x += 115) ctx.fillRect(x, 606, 54, 8)
    drawRobot()
  }

  function drawRobot(){
    if(assets.robot.ready){ ctx.drawImage(assets.robot, -18, 575, 140, 165); return }
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

    ctx.save()
    ctx.globalAlpha = alpha
    ctx.strokeStyle = 'rgba(255,255,255,.78)'
    ctx.lineWidth = 13
    ctx.lineCap = 'round'
    ctx.setLineDash([1, 24])
    ctx.beginPath(); ctx.moveTo(sx, sy + 12); ctx.lineTo(tx, ty + 12); ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = 'rgba(255,246,207,.92)'
    ctx.strokeStyle = 'rgba(112,71,28,.22)'
    ctx.lineWidth = 4
    roundRect(x - 62, y - 92, 124, 42, 21); ctx.fill(); ctx.stroke()
    ctx.fillStyle = '#70471c'
    ctx.font = '900 23px ui-rounded, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('sleep', x, y - 70)
    ctx.font = '72px ui-rounded, system-ui, sans-serif'
    ctx.fillText('☝️', x, y)
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
    ctx.save()
    ctx.globalAlpha = disabled ? .48 : 1
    ctx.fillStyle = disabled ? 'rgba(210,196,171,.92)' : 'rgba(255,246,207,.95)'
    ctx.strokeStyle = disabled ? 'rgba(112,71,28,.14)' : 'rgba(112,71,28,.24)'
    ctx.lineWidth = 5
    roundRect(add.x - add.size / 2, add.y - add.size / 2, add.size, add.size, 24)
    ctx.fill(); ctx.stroke()
    ctx.fillStyle = disabled ? '#9d8b72' : '#3f9f47'
    ctx.font = '1000 56px ui-rounded, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('+', add.x, add.y - 3)
    ctx.restore()
  }

  function drawTrashZone(){
    const trash = DISCOVER_UI.trash
    const active = drag && overTrash({ x: getGear(drag.id)?.x || -999, y: getGear(drag.id)?.y || -999 })
    ctx.save()
    ctx.fillStyle = active ? 'rgba(255,225,215,.96)' : 'rgba(255,246,207,.88)'
    ctx.strokeStyle = active ? 'rgba(214,81,56,.72)' : 'rgba(112,71,28,.20)'
    ctx.lineWidth = active ? 7 : 5
    roundRect(trash.x - trash.size / 2, trash.y - trash.size / 2, trash.size, trash.size, 28)
    ctx.fill(); ctx.stroke()
    ctx.font = '54px ui-rounded, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('🗑️', trash.x, trash.y + 1)
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

  function render(dt){
    drawBackground()
    gears.forEach(drawGear)
    drawDiscoverControls()
    drawDragHint()
    drawEffects(dt)
  }

  function update(dt){
    gears.forEach(g => {
      if(!drag || drag.id !== g.id) g.angle += g.speed * dt
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

  function answer(dir){
    if(mode !== 'choose') return
    showFeedback(dir === chooseQuestion.answer ? '✓' : '↻')
    setTimeout(resetChoose, 620)
  }

  function showFeedback(text){
    feedback.textContent = text
    feedback.classList.add('show')
    clearTimeout(showFeedback.timer)
    showFeedback.timer = setTimeout(() => feedback.classList.remove('show'), 420)
  }

  discoverBtn.addEventListener('click', () => setMode('discover'))
  chooseBtn.addEventListener('click', () => setMode('choose'))
  leftBtn.addEventListener('click', () => answer(-1))
  rightBtn.addEventListener('click', () => answer(1))
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)
  window.addEventListener('resize', resize, { passive:true })

  resize()
  setMode('discover')
  requestAnimationFrame(loop)
})()
