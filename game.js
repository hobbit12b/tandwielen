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
  const TOOTH_ADDENDUM = TOOTH_DEPTH * 0.44
  const TOOTH_DEDENDUM = TOOTH_DEPTH * 0.56
  const MESH_TOOTH_OVERLAP = 6
  const SNAP_TOLERANCE = 42
  const START_SPEED = 0.34 // rustig ontdekspeelgoed, geen arcade-snelheid
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
      makeGear('start', 310, 370, 14, '#59c765', { fixed:true, driver:true, speed:START_SPEED, accent:'#dff6a8' }),
      makeGear('blue', 620, 245, 12, '#4fb5e8', { accent:'#d9f5ff', angle:.2 }),
      makeGear('orange', 690, 505, 16, '#f6a33b', { accent:'#ffe6a7', angle:.7 }),
      makeGear('pink', 930, 345, 10, '#ec6fae', { accent:'#ffd8eb', angle:1.1 })
    ]
    links = []
    clickEffects = []
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
    choosePanel.hidden = mode !== 'choose'
    drag = null
    if(mode === 'discover') resetDiscover()
    else resetChoose()
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
    links = links.filter(l => l.a !== gear.id && l.b !== gear.id)
    if(!gear.driver) gear.speed = 0
    propagateRotation()
  }


  function meshDistance(a, b){
    // De hartafstand is bewust een aparte meshDistance: iets kleiner dan alleen
    // pitchRadius + pitchRadius. Daardoor zakt de brede tandtop visueel in de
    // diepe root-valley van de buur, zonder dat de pitch-steek verandert.
    return a.pitchRadius + b.pitchRadius - MESH_TOOTH_OVERLAP
  }

  function nearestValleyAngle(anchor, angle){
    const pitchAngle = TWO_PI / anchor.teeth
    // Valleien liggen precies halverwege twee tandtoppen van het vaste wiel.
    const valleyIndex = Math.round((normAngle(angle - anchor.angle) / pitchAngle) - 0.5)
    return anchor.angle + (valleyIndex + 0.5) * pitchAngle
  }

  function phaseGearForMesh(anchor, loose, meshAngle){
    const loosePitch = TWO_PI / loose.teeth
    // Op de contactlijn wijst een tandtop van het losse wiel naar een vallei van
    // het anker. Zo vallen de rechthoekige tanden zichtbaar in de open ruimtes.
    const toothIndex = Math.round((meshAngle + Math.PI - loose.angle) / loosePitch)
    loose.angle = meshAngle + Math.PI - toothIndex * loosePitch
  }

  function trySnap(gear){
    if(mode !== 'discover') return false
    const anchors = gears.filter(g => g.id !== gear.id && Math.abs(g.speed) > 0.001)
    let best = null
    anchors.forEach(anchor => {
      const wanted = meshDistance(anchor, gear)
      const d = dist(anchor, gear)
      const error = Math.abs(d - wanted)
      if(error < SNAP_TOLERANCE && (!best || error < best.error)) best = { anchor, error, d }
    })
    if(!best) return false

    const rawAngle = Math.atan2(gear.y - best.anchor.y, gear.x - best.anchor.x)
    const meshAngle = nearestValleyAngle(best.anchor, rawAngle)
    const wanted = meshDistance(best.anchor, gear)
    gear.x = best.anchor.x + Math.cos(meshAngle) * wanted
    gear.y = best.anchor.y + Math.sin(meshAngle) * wanted
    phaseGearForMesh(best.anchor, gear, meshAngle)
    links = links.filter(l => l.a !== gear.id && l.b !== gear.id)
    links.push({ a: best.anchor.id, b: gear.id })
    propagateRotation()
    popClick(gear.x, gear.y, gear)
    return true
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
    const gear = gearAt(p)
    if(!gear || gear.fixed || mode !== 'discover') return
    canvas.setPointerCapture(evt.pointerId)
    disconnectGear(gear)
    drag = { id: gear.id, dx: p.x - gear.x, dy: p.y - gear.y, pointerId: evt.pointerId }
    gears = gears.filter(g => g.id !== gear.id).concat(gear)
  }

  function onPointerMove(evt){
    if(!drag) return
    const gear = getGear(drag.id)
    const p = pointerToWorld(evt)
    gear.x = clamp(p.x - drag.dx, gear.outerRadius + 18, WORLD.w - gear.outerRadius - 18)
    gear.y = clamp(p.y - drag.dy, 126 + gear.outerRadius, WORLD.h - gear.outerRadius - 18)
    if(trySnap(gear)) drag = null
  }

  function onPointerUp(evt){
    if(!drag || drag.pointerId !== evt.pointerId) return
    const gear = getGear(drag.id)
    trySnap(gear)
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
      const valleyFloorEnd = c - pitch * .34
      const leftShoulder = c - pitch * .21
      const topLeft = c - pitch * .15
      const topRight = c + pitch * .15
      const rightShoulder = c + pitch * .21
      const valleyFloorStart = c + pitch * .34
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
    ctx.restore()
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
    if(assets.robot.ready){ ctx.drawImage(assets.robot, 920, 92, 210, 250); return }
    ctx.save(); ctx.translate(1010, 155)
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
    drawEffects(dt)
  }

  function update(dt){
    gears.forEach(g => {
      if(!drag || drag.id !== g.id) g.angle += g.speed * dt
      g.pulse = Math.max(0, g.pulse - dt * 2.8)
    })
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
