{
    let editor
    let printedVMCodeView


    // poll blazor until it's initialized
    const interval = setInterval(() => {
        try {
            invoke('Init', 'int main(){return 2+2;}')
            clearInterval(interval)
            main()
        } catch (error) {
            // blazor not initialized yet
        }
    }, 100)

    function main() {

        const isNoScript = script.noScript === true

        const wired = app({

            locked: isNoScript ? {} : {
                cCode: true,
                compileBtn: true,
                stepBtn: true,
                runBtn: true,
            },

            emailVisible: false,

            highlighted: {},

            isWriting: false,

            isBlinking: !isNoScript,

            scriptIndex: -1,

            chatExpanded: false,
            chatParagraphs: [],

            decoratedAddresses: {},
            ctx: null,

            stackFrames: [],
            objects: [],

            codeFrom: 0,
            stackFrom: 0,
            heapFrom: 0,

            MEMORY_VIEW_SIZE: 25,
            printedVMCode: '',
            isCompilerError: true,
            cCode: isNoScript ? `int main() {
    return sum(5);
}

int sum(int n) {
    if(!n) return 0;
    return 1 + sum(n - 1);
}` : ''
        }, {
                setState: newState => _ => Object.assign({}, newState),
                getState: _ => state => state
            }, view, document.getElementById('ha-root'))

        function getState() {
            return wired.getState()
        }
        function lazyHandler(handler) {
            return function (ev) {
                const state = getState()
                handler(state, ev)
                wired.setState(state)
            }
        }

        function view() {
            return h(
                'div', {
                    class: 'ha-container',
                    onclick: lazyHandler((state, e) => {
                        state.chatExpanded = false
                    })
                },
                CCodeSection(),
                InstructionsSection(),
                MemorySection(getState().codeFrom, lazyHandler((state, arg) => state.codeFrom = Math.max(0, state.codeFrom + arg)), 3),
                MemorySection(getState().stackFrom, lazyHandler((state, arg) => state.stackFrom = Math.max(0, state.stackFrom + arg)), 4),
                MemorySection(getState().heapFrom, lazyHandler((state, arg) => state.heapFrom = Math.max(0, state.heapFrom + arg)), 5),
                StackFramesTexts(),
                InstructionsTexts(),
                Chat(),
                EmailBtn()
            )
        }

        function CCodeSection() {

            if (editor) {
                const val = getState().cCode
                const actualVal = editor.getValue()
                if (val !== actualVal) {
                    editor.setValue(val)
                    editor.selection.clearSelection()
                }
                editor.setReadOnly(getState().locked.cCode)
            }


            return h(
                'div',
                { class: 'generic-container shadow ' },
                h('pre', {
                    class: classIf(getState().locked.cCode, 'locked'),
                    onmouseover: lazyHandler(state => handleEvent(state, 'code-hovered')),
                    id: 'editor',
                    oncreate: lazyHandler(_ => {
                        editor = ace.edit("editor")
                        editor.session.setUseWrapMode(true)
                        editor.setHighlightActiveLine(false)
                        editor.setFontSize(15)
                        editor.renderer.setShowGutter(false)
                        editor.setTheme("ace/theme/sqlserver")
                        editor.session.setMode("ace/mode/c_cpp")

                        editor.session.on('change', () => {
                            lazyHandler(state => {
                                const text = editor.session.getValue()
                                localStorage.setItem('c-code', text)
                                state.cCode = text
                            })()
                        })

                    })
                }),
                CompileBtn()
            )
        }



        function CompileBtn() {
            return h(
                'div', {
                    class: 'generic-top-right-btn compile-btn' + classIf(getState().locked.compileBtn || getState().isWriting, 'locked'),
                    onclick: lazyHandler((state, e) => {
                        e.stopPropagation()
                        if (getState().locked.compileBtn || getState().isWriting) return
                        try {
                            invoke('Init', getState().cCode)
                            state.isCompilerError = false
                            getNewPrintedCode(state)
                            state.codeFrom = invoke('IP')
                            state.heapFrom = invoke('HP')
                            state.stackFrom = invoke('SP')
                            state.stackFrames = [{
                                begin: state.stackFrom - 1,
                                firstInstruction: state.codeFrom,
                                bp: state.stackFrom + 1
                            }]
                            state.objects = []
                            state.ctx = invoke('CTX')
                            state.decoratedAddresses = decorateStackAddresses()
                            handleEvent(state, 'compile-clicked')
                        } catch (error) {
                            const end = error.message.indexOf('at Microsoft.JSInterop')
                            state.isCompilerError = true
                            state.printedVMCode = error.message.substring(18, end)
                            handleEvent(state, 'compile-failed')
                        }
                    }),
                    onmouseover: lazyHandler(state => handleEvent(state, 'compile-hovered'))
                },
                'Compile'
            )
        }

        function InstructionsSection() {

            if (printedVMCodeView) {
                const val = getState().printedVMCode
                printedVMCodeView.setValue(val)
            }


            return h(
                'div',
                { class: 'generic-container shadow' + classIf(getState().highlighted[2], 'box-shadow-highlighted') },
                h('pre', {
                    id: 'printed-view',
                    oncreate: lazyHandler(_ => {
                        printedVMCodeView = ace.edit("printed-view")
                        printedVMCodeView.session.setUseWrapMode(true)
                        printedVMCodeView.setFontSize(15)
                        printedVMCodeView.renderer.setShowGutter(false)
                        printedVMCodeView.setTheme("ace/theme/sqlserver")
                        printedVMCodeView.session.setMode("ace/mode/c_cpp")
                        printedVMCodeView.setReadOnly(true)
                        printedVMCodeView.renderer.$cursorLayer.element.style.display = "none"
                        printedVMCodeView.selection.clearSelection()

                        let isSelecting = false

                        printedVMCodeView.selection.on('changeSelection', function (e) {

                            if (isSelecting) return
                            isSelecting = true

                            const toSelect = findLineOfNextInstruction()
                            printedVMCodeView.selection.clearSelection()
                            if (toSelect !== -1) {
                                printedVMCodeView.selection.moveCursorTo(toSelect, 0)
                                printedVMCodeView.selection.selectLine()
                            }

                            isSelecting = false

                        })
                    })
                }),
                !getState().isCompilerError && StepBtn() || null,
                !getState().isCompilerError && RunBtn() || null
            )
        }

        function StepBtn() {
            return h(
                'div', {
                    class: 'generic-top-right-btn' + classIf(getState().locked.stepBtn || getState().isWriting, 'locked'),
                    onclick: lazyHandler((state, e) => {
                        e.stopPropagation()
                        if (getState().locked.stepBtn || getState().isWriting) return
                        state.emailVisible = true
                        handleEvent(state, 'step-clicked')
                        updateStackFramesAndHeapObjects(state) // always before step
                        if (!invoke('Step')) {
                            const ret = invoke('MemorySlice', invoke('SP'), 1)[0]
                            alert("returned value: " + ret)
                            state.isCompilerError = true // reset
                            state.printedVMCode = ''
                            return
                        }
                        state.decoratedAddresses = decorateStackAddresses()
                        getNewPrintedCode(state)


                        // auto scroll the second sectino
                        const firstRenederedLine = printedVMCodeView.renderer.layerConfig.firstRow
                        const lastRenederedLine = printedVMCodeView.renderer.layerConfig.lastRow
                        const nextInstructionLine = findLineOfNextInstruction()
                        if (nextInstructionLine < firstRenederedLine || nextInstructionLine + 2 > lastRenederedLine) {
                            printedVMCodeView.scrollToLine(nextInstructionLine, false)
                        }

                        // auto scroll sp section

                        const sp = invoke('SP')
                        if (state.stackFrom > sp) {
                            state.stackFrom = sp - Math.floor(state.MEMORY_VIEW_SIZE / 2)
                        }

                        if (sp > state.stackFrom + state.MEMORY_VIEW_SIZE - 1) {
                            state.stackFrom = sp - Math.floor(state.MEMORY_VIEW_SIZE / 2)
                        }

                        state.stackFrom = Math.max(0, state.stackFrom) // todo also upper bound


                        // auto scroll ip section
                        const ip = invoke('IP')
                        if (state.codeFrom > ip) {
                            state.codeFrom = ip - Math.floor(state.MEMORY_VIEW_SIZE / 2)
                        }

                        if (ip > state.codeFrom + state.MEMORY_VIEW_SIZE - 1) {
                            state.codeFrom = ip - Math.floor(state.MEMORY_VIEW_SIZE / 2)
                        }

                        state.codeFrom = Math.max(0, state.codeFrom) // todo also upper bound

                        // auto scroll heap section
                        const hp = invoke('HP')
                        if (state.heapFrom > hp) {
                            state.heapFrom = hp - Math.floor(state.MEMORY_VIEW_SIZE / 2)
                        }

                        if (hp > state.heapFrom + state.MEMORY_VIEW_SIZE - 1) {
                            state.heapFrom = hp - Math.floor(state.MEMORY_VIEW_SIZE / 2)
                        }

                        state.heapFrom = Math.max(0, state.heapFrom) // todo also upper bound

                        renderOverlaysLater()
                    })
                },
                'Step'
            )
        }

        function RunBtn() {
            return h(
                'div', {
                    class: 'generic-top-right-btn generic-top-right-btn--second' + classIf(getState().locked.runBtn || getState().isWriting, 'locked'),
                    onclick: lazyHandler((state, e) => {
                        e.stopPropagation()
                        if (getState().locked.runBtn || getState().isWriting) return
                        while (invoke('Step')) { }
                        const ret = invoke('MemorySlice', invoke('SP'), 1)[0]
                        alert("main() returned " + ret)
                        state.isCompilerError = true // reset
                        state.printedVMCode = ''
                    })
                },
                'Run'
            )
        }

        function MemorySection(sliceBegin, scroll, colNumber) {

            const registers = {
                [invoke('BP')]: 'BP',
                [invoke('SP')]: 'SP',
                [invoke('IP')]: 'IP',
                [invoke('HP')]: 'HP'
            }

            const viewSize = getState().MEMORY_VIEW_SIZE

            let memorySlice
            if (!getState().isCompilerError) {
                memorySlice = invoke('MemorySlice', sliceBegin, viewSize)
            } else {
                memorySlice = [...Array(viewSize)].map(_ => null)
            }

            const template = 'repeat(' + viewSize + ', 1fr)'
            return h(
                'div', {
                    onwheel: e => {
                        scroll(Math.sign(e.deltaY))
                        renderOverlaysLater()
                    },
                    class: 'generic-container memory' + classIf(getState().highlighted[colNumber], 'box-shadow-highlighted'),
                    style: {
                        'grid-template-rows': template
                    }
                },
                memorySlice.map((val, i) => AddressAndValue(sliceBegin + i, val, registers))
            )

        }

        function AddressAndValue(adr, value, registers) {

            const state = getState()

            let color = 'color-grey'
            if (!isCompilerError()) {
                if (registers[adr] == 'SP') {
                    if (invoke('BP') === adr)
                        color = 'color-sp-bp'
                    else
                        color = 'color-sp'
                } else if (registers[adr] == 'BP') {
                    color = 'color-bp'
                } else if (registers[adr] == 'IP') {
                    color = 'color-ip'
                } else if (registers[adr] == 'HP') {
                    color = 'color-hp'
                }
            }

            const decoratedAddress = state.decoratedAddresses[adr]
            const addressOfdecoratedAddress = state.decoratedAddresses[value]
            const opCodeToStr = opCodeToString(value)

            const inParanthesis = isCompilerError() ? null
                : opCodeToStr ? opCodeToStr
                    : decoratedAddress ? decoratedAddress
                        : addressOfdecoratedAddress ? ('&' + addressOfdecoratedAddress)
                            : null

            return h(
                'div', {
                    class: 'address-and-value ' + classIf(getState().highlighted['adr' + adr], 'box-shadow-highlighted'),
                    key: adr
                },
                h(
                    'div', {
                        'data-address': adr,
                        class: 'block block-address vertical-align ' + color
                    },
                    isCompilerError() ? null : adr
                ), h(
                    'div', {
                        class: 'block block-value vertical-align color-grey'
                    },
                    Paranthesize(inParanthesis),
                    h('pre', {}, ' '),
                    value
                )
            )
        }

        function Paranthesize(value) {

            if (!value) return null

            return h(
                'span', {
                    class: 'address-paranthesis'
                },
                '(' + value + ')'
            )

        }

        function StackFramesTexts() {

            if (isCompilerError()) {
                return null
            }

            const texts = []

            const frames = getState().stackFrames
            for (let i = 0; i < frames.length; i++) {

                const { begin, firstInstruction } = frames[i]

                let beginEl = getBlockWithAddress(begin)
                const end = i !== frames.length - 1 ? (frames[i + 1].begin - 1) : invoke('SP')
                let endEl = getBlockWithAddress(end)

                if (!beginEl || !endEl) {

                    if (endEl) {
                        beginEl = getBlockWithAddress(getState().stackFrom)
                    } else if (beginEl) {
                        endEl = getBlockWithAddress(getState().stackFrom + getState().MEMORY_VIEW_SIZE - 1)
                    }
                    else continue
                }

                if (!beginEl || !endEl) continue // sometimes getBlockWithAddress above returns null because document.queryselector read old data

                // draw text using begin and endEL
                texts.push(makeLineBetween(endEl, beginEl, 2.5, getFuncName(firstInstruction), 'sf-' + i))
            }

            return texts
        }

        function InstructionsTexts() {

            if (isCompilerError()) {
                return null
            }

            const state = getState()

            const texts = []

            const functions = state.ctx.backPatch.functionStartAddress.slice().sort((p1, p2) => p1.value < p2.value ? -1 : 1)

            for (let i = 0; i < functions.length; i++) {

                const { key: funcName, value: funcAdr } = functions[i]

                let beginEl = getBlockWithAddress(funcAdr)
                const funcEnd = i !== functions.length - 1 ? (functions[i + 1].value - 1) : state.ctx.segments.nextCodeAddress - 1
                let endEl = getBlockWithAddress(funcEnd)

                if (!beginEl || !endEl) {

                    if (endEl) {
                        beginEl = getBlockWithAddress(state.codeFrom)
                    } else if (beginEl) {
                        endEl = getBlockWithAddress(state.codeFrom + state.MEMORY_VIEW_SIZE - 1)
                    } else if (funcAdr < state.codeFrom && funcEnd > state.codeFrom + state.MEMORY_VIEW_SIZE - 1) {
                        // we are viewing the function but we don't see neiher the end nor the beginning
                        beginEl = getBlockWithAddress(state.codeFrom)
                        endEl = getBlockWithAddress(state.codeFrom + state.MEMORY_VIEW_SIZE - 1)
                    }
                    else continue
                }

                if (!beginEl || !endEl) continue // sometimes getBlockWithAddress above returns null because document.queryselector read old data

                // draw text using begin and endEL
                texts.push(makeLineBetween(endEl, beginEl, 2.5, funcName, 'it-' + funcName))
            }

            return texts
        }


        function Chat() {

            if (isNoScript) return null

            const state = getState()

            return h(
                'div', {
                    class: 'chat-btn shadow ' + classIf(state.chatExpanded, 'chat-btn-expanded') + classIf(state.isBlinking, 'blinking'),
                    onclick: lazyHandler((state, e) => {
                        e.stopPropagation()
                        if (state.chatExpanded) {
                            handleEvent(state, 'chat-clicked')
                        }
                        else {
                            state.isBlinking = false
                            handleEvent(state, 'bubble-clicked')
                        }

                        state.chatExpanded = true
                    })
                },
                h(
                    'div', {
                        class: 'chat-inner',
                    },
                    h(
                        'div',
                        { class: 'chat-scrollable' },
                        state.chatParagraphs.map(p => h(
                            'div',
                            { class: 'chat-paragraph' + classIf(p.startsWith('('), 'fade-grey-color') },
                            p
                        ))
                    )
                )
            )
        }

        function EmailBtn() {
            return h(
                'div', {
                    class: 'bot-left-btns' + classIf(getState().emailVisible, ' bot-left-btns-visible')
                },
                h('div', {
                    class: 'bot-left-btn',
                    onclick: function () {
                        window.open('https://github.us20.list-manage.com/subscribe/post?u=2790571880963241ec5dd7d11&id=0e2d1b34de', '_blank')
                    }
                },
                    'Get notified when new tutorials are released'
                ),

                h('div', {
                    class: 'bot-left-btn',
                    onclick: function () {
                        window.open('https://github.com/vasyop/miniC-hosting/blob/master/support.md', '_blank')
                    }
                },
                    'Support this project'
                )
            )
        }


        //utils...
        function getNewPrintedCode(state) {
            const printed = invoke('PrintInstructions')
            state.printedVMCode = printed.split('\n').slice(1).join('\n')
        }

        function findLineOfNextInstruction() {

            const ip = invoke('IP')
            const slice = invoke('MemorySlice', ip, 2)
            const op2Str = opCodeToString(slice[0])

            const printedView = getState().printedVMCode
            const index = printedView.indexOf(invoke('IP') + ' ' + op2Str)

            if (index == -1) {
                return -1
            }

            let i = 0
            let line = 0
            // search for ->
            while (i < index) {
                i++
                if (printedView[i] == '\n') {
                    line++
                }
            }

            return line
        }

        function isCompilerError() {
            return getState().isCompilerError
        }



        const opCodeToStringCache = {}
        function opCodeToString(value) {
            if (opCodeToStringCache[value] !== undefined) {
                return opCodeToStringCache[value]
            }
            return opCodeToStringCache[value] = invoke('OpCodeToString', Number(value))
        }

        function updateStackFramesAndHeapObjects(state) {
            const sp = invoke('SP')
            const hp = invoke('HP')
            const ip = invoke('IP')
            const slice = invoke('MemorySlice', ip, 2)
            const op2Str = opCodeToString(slice[0])
            const arg = slice[1]

            if (op2Str == 'CALL') {
                state.stackFrames.push({
                    begin: sp - arg,
                    firstInstruction: invoke('MemorySlice', sp - arg, 1)[0],
                    bp: sp + 2
                })
            }
            if (op2Str == 'RET') {
                state.stackFrames.pop()
            }

            if (op2Str == 'ALLOC') {
                state.objects.push({
                    begin: hp,
                    size: invoke('MemorySlice', sp, 1)[0]
                })
            }
        }

        function getBlockWithAddress(adr) {
            return document.querySelector('[data-address="' + adr + '"]')
        }

        function makeLineBetween(div1, div2, thickness, fName, key) {
            var off1 = getOffset(div1)
            var off2 = getOffset(div2)
            // bottom leftish
            var x1 = off1.left + off1.width / 50
            var y1 = off1.top + off1.height * 4 / 5
            // top left
            var x2 = off2.left + off2.width / 50
            var y2 = off2.top + off2.height * 1 / 5
            // distance
            var length = Math.sqrt(((x2 - x1) * (x2 - x1)) + ((y2 - y1) * (y2 - y1)))
            // center
            var cx = ((x1 + x2) / 2) - (length / 2)
            var cy = ((y1 + y2) / 2) - (thickness / 2)
            // angle
            var angle = Math.atan2((y1 - y2), (x1 - x2)) * (180 / Math.PI)
            // make hr

            return h(
                'div', {
                    key,
                    class: 'stack-frame-line color-kw',
                    style: {
                        left: cx + 'px',
                        top: cy + 'px',
                        width: length + 'px',
                        height: thickness + 'px',
                        transform: 'rotate(' + angle + 'deg) translateY(5px)'
                    }
                },
                h(
                    'div',
                    { class: 'stack-frame-line-text' },
                    fName
                )
            )
        }

        function getOffset(el) {
            const rect = el.getBoundingClientRect()
            return {
                left: rect.left + window.pageXOffset,
                top: rect.top + window.pageYOffset,
                width: rect.width || el.offsetWidth,
                height: rect.height || el.offsetHeight
            }
        }

        function decorateStackAddresses() {

            const ret = {}
            const state = getState()
            const ctx = state.ctx
            if (!ctx) return

            for (const { firstInstruction, bp } of state.stackFrames) {

                const funcName = ctx.backPatch.functionStartAddress.find(pair => pair.value === firstInstruction).key
                const funcDecl = ctx.semantics.globalIdentifiers.find(pair => pair.key === funcName)

                ret[bp] = 'OLD BP'
                ret[bp - 1] = 'RET IP'

                let offset = 2
                for (const param of funcDecl.value.parameterList.parameters.slice().reverse()) {
                    ret[bp - offset] = 'ARG ' + param.name
                    offset++
                }

                ret[bp - offset] = '&FN ' + funcName

                offset = 1
                const localVars = ctx.semantics.localVars.find(pair => pair.key.name === funcName).value
                for (const local of localVars) {
                    ret[bp + offset++] = 'VAR ' + local
                }
            }

            for (const obj of state.objects) {
                for (let i = 0; i < obj.size; i++) {
                    ret[obj.begin + i] = 'OB[' + obj.size + ',' + i + ']'
                }
            }

            return ret
        }

        function getFuncName(firstInstruction) {
            return getState().ctx.backPatch.functionStartAddress.find(pair => pair.value === firstInstruction).key
        }

        function renderOverlaysLater() {
            setTimeout(lazyHandler(() => { }), 30) // rerender to make sure the stack frame texts read the latest DOM data before rendering
        }

        function classIf(cond, clas) {
            return ' ' + (cond ? clas : '')
        }

        function handleEvent(state, event) {

            if (state.isWriting)
                return

            const nextScriptItem = script[state.scriptIndex + 1]

            if (!nextScriptItem || event !== nextScriptItem.type)
                return

            state.scriptIndex++

            if (nextScriptItem.txt) {
                if (!nextScriptItem.compile) {
                    writeScriptItem(state)
                } else {
                    setTimeout(lazyHandler(state => {

                        // save old state
                        const oldLock = state.locked.compileBtn
                        const oldWriting = state.isWriting

                        // do this, otherwise the click won't work
                        state.locked.compileBtn = false
                        state.isWriting = false

                        setTimeout(lazyHandler(_ => {
                            document.querySelector('.compile-btn').click()
                        }))

                        setTimeout(lazyHandler(state => {
                            state.locked.compileBtn = oldLock
                            state.isWriting = oldWriting
                            writeScriptItem(state)
                        }))
                    }))
                }
            } else if (nextScriptItem.locked !== undefined) {
                state.locked = nextScriptItem.locked
                handleEvent(state, script[state.scriptIndex + 1].type)
            } else if (nextScriptItem.highlighted) {
                state.highlighted = nextScriptItem.highlighted
                handleEvent(state, script[state.scriptIndex + 1].type)
            } else if (nextScriptItem.code !== undefined) {
                state.cCode = nextScriptItem.code
                handleEvent(state, script[state.scriptIndex + 1].type)
            } else if (nextScriptItem.go2nextSection) {

                const idx = Number(window.location.search.substr(1)) + 1

                if (scripts[idx])
                    location.replace(location.origin + '/miniC-hosting?' + (Number(window.location.search.substr(1)) + 1))
                else
                    location.replace('https://github.com/vasyop/miniC-hosting/blob/master/support.md')
            }
        }

        function writeScriptItem(state) {

            state.chatExpanded = true

            const txt = script[state.scriptIndex].txt

            state.chatParagraphs.push('')
            state.isWriting = true
            txt.split('').forEach((letter, i) => setTimeout(lazyHandler(state => {
                state.chatParagraphs[state.chatParagraphs.length - 1] += letter
                scrollToBottom(document.getElementsByClassName('chat-scrollable')[0])
                if (i == txt.length - 1) {
                    state.isWriting = false
                    handleEvent(state, 'bot-finished')
                }

            }), 10 + i * 5))
        }
    }

    function invoke() {
        return DotNet.invokeMethod(...['Blazor2', ...arguments])
    }

    function scrollToBottom(objDiv) {
        objDiv.querySelector(':last-child').scrollIntoView()
    }

    function addClickToContinues(items) {
        const newItems = []
        for (let i = 0; i < items.length; i++) {

            const item = items[i]
            newItems.push(item)
            const next = items[i + 1]

            if (next && item.txt && next.type === 'chat-clicked' && next.txt !== ' ') {
                newItems.push(...onFinished('(click chat to continue)'))
            }
        }

        return newItems
    }

    function flatten(items) {
        const res = []
        for (const item of items) {
            if (item instanceof Array) {
                res.push(...item)
            } else {
                res.push(item)
            }
        }
        return res
    }

    function onBubble(txt) {
        return {
            type: 'bubble-clicked',
            txt
        }
    }

    function onChatClicked() {
        return [].slice.call(arguments).map((arg, i) => ({
            type: i == 0 ? 'chat-clicked' : 'bot-finished',
            txt: arg
        }))
    }

    function onChatClickedToNextSection() {
        return {
            type: 'chat-clicked',
            go2nextSection: true
        }
    }

    function onFinished() {
        return [].slice.call(arguments).map(arg => ({
            type: 'bot-finished',
            txt: arg
        }))
    }

    function onCompileHovered(txt) {
        return {
            type: 'compile-hovered',
            txt
        }
    }
    function onStepClicked(txt) {
        return {
            type: 'step-clicked',
            txt
        }
    }
    function onCompileClicked(txt) {
        return {
            type: 'compile-clicked',
            txt
        }
    }

    function onCompileFailed(txt) {
        return {
            type: 'compile-failed',
            txt
        }
    }

    function onCodeHovered(txt) {
        return {
            type: 'code-hovered',
            txt
        }
    }

    function onFinishedChangeLockAndAdvance(locked) {
        return {
            type: 'bot-finished',
            locked
        }
    }

    function onFinishedSetCodeAndAdvance(code) {
        return {
            type: 'bot-finished',
            code
        }
    }

    function onFinishedCompileAndWrite(txt) {
        return {
            type: 'bot-finished',
            txt,
            compile: true
        }
    }

    function onFinishedSetHighLightAndAdvance(highlighted) {
        return {
            type: 'bot-finished',
            highlighted
        }
    }

    function makeLock(cCode, compileBtn, stepBtn, runBtn) {
        return {
            cCode,
            compileBtn,
            stepBtn,
            runBtn
        }
    }

    function makeHighLights() {
        return [].slice.call(arguments).reduce((res, arg) => (res[arg] = true, res), {})
    }

    const scripts = [

        // part 1 intro

        addClickToContinues(flatten([
            onBubble("Oh, hi there!"),
            onFinished(
                'I\'m Jarvis and you\'re about to start your adventure inside the C programming language and the machine that runs it. ',
                'Feeling up to the challenge?'
            ),
            onChatClicked('  '),
            onFinishedSetCodeAndAdvance(`int main() {
    return 132 - 531;
}`),
            onFinished(
                'I knew it! There is some C code in the first column. Do you see it?',
                '(put your cursor on the C code to continue)'
            ),
            onCodeHovered('Yes, that\'s it. What do you think it means?'),
            onChatClicked(
                'It just says: "do 132 - 531 and then give me back the result"',
                'The C language is quite intuitive, isn\'t it? ',
                'The interesting part is how it all happens. Let\'s have a look.'
            ),
            onChatClicked(
                'Those 3 lines of code are called a "program". It\'s just a list of steps for the computer to follow.',
                'After you write a program like that, some kind of machine has to read it and follow the steps.',
                'That\'s the whole point of programming. Hopefully the machine can do it faster and/or cheaper than yourself.'
            ),
            onChatClicked(
                'You might be wondering what I mean by "machine".',
                'Well, something that I can give a list of numbers, start it, and then it gives me a list of numbers back.',
                'It\'s that simple.'
            ),
            onChatClicked(
                'Your computer is a machine just as I described it above, with a little extra flavor on top.',
                'We call the numbers (that the machine works with) "memory".',
                'After figuring out what the new numbers should be, only a few of them actually change and this is what the "processor" or CPU\'s job is: reading some numbers from memory, figuring out which have to change, and changing them.',
                'After that, it doesn\'t stop, it goes on. We are about to see how.',
                'We are going to look at what the processor does, how the memory looks along the way, and how programming languages such as C can work under the hood.'
            ),
            onChatClicked(
                'We use numbers and not something else because it\'s not that hard to make circuits that, say, add two numbers.',
                'I don\'t know about you though, but I would quickly lose my mind if I had to write numbers into a computer all day.',
                'But here is an idea. Write a program in something that looks more like English than plain numbers (such as that C code over there).',
                'Then turn the C code into numbers, then give the numbers to the machine.'
            ),
            onFinishedChangeLockAndAdvance(makeLock(true, false, true, true)),
            onChatClicked(
                'See that "Compile" button?',
                '(click "Compile" to continue)'
            ),
            onCompileClicked('WOW! Lots of things going on.'),
            onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),
            onFinishedSetHighLightAndAdvance(makeHighLights(3, 4, 5)),
            onFinished(
                'The 3rd, 4th and 5th columns are parts of the memory of our machine.',
                'It has 50000 slots (0 to 49999) where it can store numbers and we call these slots "addresses".',
                'The left number is the address of the number and the right is the actual number stored at that address.',
                'For instance, the number at address 10006 is 1028.',
                'There are also 4 other special slots called "registers" (we will talk about them shortly).',
            ),
            onChatClicked('The 3rd column shows the memory from 10000 to 10024.'),
            onFinishedSetHighLightAndAdvance(makeHighLights(3)),
            onFinished(
                'When you hit "Compile", the 3 lines of C code were turned into the numbers 1000, 0, 1002, 2...1001, 0 and those numbers were inserted at the addresses 10000 - 10010. All the other numbers are 0s (except the registers).',
                'We say that a "compiler" "compiles" our program, which just means that it checks the code is correct (we will expand on that) and if so, it translates it into numbers.'
            ),
            onChatClicked(
                'Once you know C, we will look closer at the compiler and write a piece of it. ',
                'We call the memory section from address 10000 to the last instruction (10010 in this case), the "code segment".'
            ),
            onChatClicked(
                'How our machine (like most real processors) works is that when we give it the numbers and start it, it checks what number is at a certain memory address and depending on what\'s there, it then changes some other numbers. So many numbers! I know. The number that tells the machine what to do is called an "instruction".',
                'For instance, there is a "PUSH" instruction at address 10004. Of course the machine has no idea what a "PUSH" is, it only knows what to do when it sees number 1002.',
            ),
            onChatClicked(
                'For us though, it\'s easier to read and write "PUSH", "PLUS" or "RET" instead of "1002, 1021, or 1001"',
                'When the machine looks at an instruction and does something, we say it\'s "executing" that instruction.',
                'We will see along the way what each instruction does.'
            ),
            onChatClicked(
                'So how does the machine know where to look for the instruction to execute?',
                'One of the 4 registers is IP, or the "instruction pointer".',
                'IP "points" to (holds the address of) the instruction that our machine will execute next.',
            ),
            onChatClicked('Right now, IP holds the number 10000, the address of the first instruction generated from our C code.'),
            onFinishedSetHighLightAndAdvance(makeHighLights('adr10000')),
            onChatClicked(
                'The address with a light blue background is always the number held by IP.',
                'This machine always starts with IP set to 10000.'
            ),
            onChatClicked(' '),
            onFinishedSetHighLightAndAdvance(makeHighLights('adr10007', 'adr10008', 'adr10006')),
            onChatClicked(
                'There are 20 or so instructions and some of them have "arguments".',
                'What that means is that right after the instruction there is a number (the argument) that is taken into consideration when the instruction is executed.',
                'The "RET" instruction is always followed by its argument. The one at address 10007 has an argument of 0 (found at 10008).',
                'The MINUS instruction at 10006 is immediately followed by the next instruction, because it has no argument.'
            ),
            onChatClicked(
                'After executing an instruction, the machine will increase IP by 2 if the instruction had an argument, or by 1 if it didn\'t.',
                'So the machine has to know, just like us, which instructions have an argument and which don\'t.',
                'It "thinks": "When I see number 1002 (that\'s a PUSH for us humans), then I will increase IP by 2, then I will use the argument right after to execute it. Then I am ready for the next instruction."',
                '"When I see number 1028 (MINUS for us), I know to increase IP by 1 (because MINUS has no argument), and then I will execute the instruction and then I am ready for the next one."'
            ),
            onChatClicked('The 2nd column is a mix between the 1st and the 3rd.'),
            onFinishedSetHighLightAndAdvance(makeHighLights(2)),
            onFinished(
                'It shows the lines of C code, each followed by the instructions generated from that line.',
                'Note that, unlike the 3rd column, the arguments go together with the instruction.',
                'For instance, at address 10002 on the second column, there is a PUSH 132, and on the next line there\'s address 10004.',
                'The 2nd column is just a nicer way of representing the 3rd.'
            ),
            onChatClicked(
                'Executing an instruction will almost always change something on the 4th column.'
            ),
            onFinishedSetHighLightAndAdvance(makeHighLights('adr30000')),
            onFinished(
                'Right now, there are two registers holding the value 30000, SP (stack pointer) and BP (base pointer). They always start at 30000 on this machine.',
                'The purple highlights the base pointer and orange highlights the stack pointer (you can\'t clearly see the colors right now because they overlap).'
            ),
            onChatClicked(
                'We call the memory section from 30000 to the the value of SP "the stack segment", or simply the "stack".',
                'Almost all the action happens on the stack, so let\'s give it a spin!',
                '(keep your eye on SP and BP (both at address 30000) and click "Step" to execute the 1st instruction)'
            ),

            onFinishedSetHighLightAndAdvance(makeHighLights()),
            onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
            onFinished(' '),
            onStepClicked(' '),
            onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),
            onFinished(
                'The machine just executed the first instruction (FSTART) with the argument 0, or FSTART 0 for short.',
                'IP predictably increased to 10002 to prepare for the next instruction: PUSH.',
                'SP and BP both moved to 30001 and the value 30000 was written at 30001.'
            ),
            onFinished(
                'We will cover FSTART in detail later, what we are really interested in now are PUSH and MINUS.',
                '(keep an eye on SP (at 30001) and click "Step" to execute the 2nd instruction: PUSH 132)'
            ),


            onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
            onFinished(' '),
            onStepClicked(' '),
            onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),
            onFinished(
                'PUSH 132 was executed. IP increased by 2 and now we see SP was increased by 1 and now points to 30002.',
                'Also, the value at SP (30002) is now 132.',
                'The number 132 was "pushed" on to the stack, we say.',
                '(keep an eye on SP (at 30002) and click "Step" to execute the 3nd instruction: PUSH 531)'
            ),


            onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
            onFinished(' '),
            onStepClicked(' '),
            onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),
            onFinished(
                'PUSH 531 was executed: IP increased by 2 once again and the number 531 was also pushed on to the stack.',
                '(keep an eye on SP and click "Step" to execute the 4th instruction: MINUS)'
            ),


            onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
            onFinished(' '),
            onStepClicked(' '),
            onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),
            onFinished(
                'MINUS was executed and the number (531) pointed by SP (30003) was subtracted from 132 found at address SP-1, then SP was decreased and the result of the subtraction (-399) was stored at the new address where SP points: 30002.',
                'Notice 531 is still at 30003. There is no point in removing it. If we end up PUSHing something later, it will be overwritten anyway.',
                '(click "Step" to execute the next instruction (RET) that will terminate the program)'
            ),


            onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
            onFinished(' '),
            onStepClicked(' '),
            onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),
            onFinished(
                'We will cover RET in detail later, but for now, RET will end our program and whatever value is at address SP (-399 in this case) is considered to be the result of the execution.',
                'By the way, we call the value at address SP the "top of the stack"',
                'Oh, and choosing numbers like 10000 (initial IP), 30000 (initial SP) or 1002 (PUSH) is up to whoever made the machine. It doesn\'t matter too much.'
            ),


            onFinishedChangeLockAndAdvance(makeLock(true, false, false, true)),
            onFinished(' '),
            onChatClicked(
                'This seems like a pretty complicated way to subtract two numbers.',
                'It\'s this way because it must also work with longer calculations such as (1-532*32)/53. You\'re about to see how.',
                'Feel free to compile and step through the small program we just covered until you are ready to move forward to the next section.',
            ),
            onChatClickedToNextSection()
        ])),

        // part 2  expressions

        addClickToContinues(flatten([

            onBubble('So, are you ready to C more?'),

            onFinished('(yes, veery funny)'),

            onChatClicked(' '),
            onFinished(
                'For that expression of yours, anytime.',
                'Speaking of which, remember "132 - 531"?',
                'That, in the world of programming languages, is an "expression".',
                'Intuitively, anything that can be computed into a number, is an expression (more on that later).'
            ),

            onChatClicked(
                'Technically, an expression can be 1 of 2 (for now) things:',
                '[1] A number (like "32").',
                '[2] An expression, followed by an "operator" and then another expression (like "535 * 32")'
            ),

            onChatClicked(
                '[2] defines an expression in terms of an expression (also called a "recursive definition"), but its purpose is more than just to twist our minds. Let me show you what I mean.',
                '"1 + 2" and is surely an expression. But "1" could have been any expression (according to [2]), which means we can replace 1 with "17 * 3" and get "17 * 3 + 2", a slightly longer expression.',
                'We can keep replacing any number with a number followed by an operator and another number, and our expression keeps expanding.'
            ),
            onChatClicked(
                'So what is the thought process of the compiler when it sees a very long expression?',
                'There is just one key observation to be made.',
                'While the machine is "evaluating" (running the instructions that will compute the result of) an expression (no matter how big), SP will always increase by some amount (depending on how big the expression is), then it will always decrease back to its original value plus 1, and the result of the expression will be on the top of the stack.',
                'Let\'s see why that is, with the help of some examples.'
            ),
            onChatClicked('  '),


            //5
            onFinishedSetCodeAndAdvance(`int main() {
    5;
}`
            ),
            onFinishedCompileAndWrite(
                'Here, the expression "5" was compiled.',
                'Just PUSH 5 on to the stack and that\'s the only instruction that we need to evaluate the expression.'
            ),
            onFinished(
                '(go ahead and step though the code)'
            ),
            onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
            onFinished(' '),
            onStepClicked(' '),
            onFinished(' '),

            onStepClicked(' '),
            onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),
            onFinished(
                'After PUSH 5, our expression has been evaluated and SP is indeed at its original value (30001, before PUSH) plus 1 (30002, no big surprise there) and the result is on the top of the stack.',
            ),
            onChatClicked(
                'Now, the POP instruction (just decreases SP by 1) is about to be executed. ',
                'Why did the compiler generate this?',
                'Well, we haven\'t said we want to do anything with that 5 (like "return 5;"), so the compiler is essentially throwing the result away (by decreasing SP by 1), as if the expression was never evaluated.',
                'The POP instruction is not part of the expression evaluation. We will see later exactly when it is generated.',
                'Some compilers try to be smart about it and will ignore the line "5;" of our C code completely. "The programmers are just being silly", they think.'
            ),
            onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
            onFinished('(go on stepping)'),
            onStepClicked(' '),
            onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),
            onFinished(
                'Notice that the compiler is always generating a "RET 0" at the very end of any program in case we forgot write any "return" (which we just did).',
                'If "RET 0" was not there right now, the machine would just attempt to execute whatever instruction IP points to after executing POP. In this case, IP would point to a "0", which doesn\'t correspond to any instruction, so the machine would just stop immediately.'
            ),
            onChatClicked(
                'It is possible, however, that IP would not point to a "0" and in that case, the machine will continue executing the instructions of another function (we will see when talking about functions), which is very unexpected, so the compiler is just making sure that never happens.',
                'Other compilers might not even compile our code if they don\'t find any "return", but this one is not that strict.'
            ),
            onChatClicked(
                'When the "RET" instruction is hit, whatever is on the top of the stack at that moment will be returned. In our case, the top of the stack, 30000, is not a meaningful value for us unless we are writing a virus, which we will, later.',
            ),
            onFinished('(go on stepping)'),
            onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
            onFinished(' '),
            onStepClicked(' '),
            onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),


            // 5 * 3
            onFinishedSetCodeAndAdvance(`int main() {
    5 * 3;
}`
            ),
            onFinishedCompileAndWrite(
                'Let\'s have a look at the expression "5 * 3".'
            ),
            onFinished(
                'It compiles to "PUSH 5, PUSH 3, TIMES". ',
                'TIMES behaves much like MINUS we saw earlier. It POPs two numbers off the stack and PUSHes the result, only this time, it multiplies the numbers).',
                '(go ahead and step though the code)'
            ),
            onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
            onFinished(' '),
            onStepClicked(' '),
            onFinished(' '),

            onStepClicked(' '),
            onStepClicked(' '),
            onStepClicked(' '),
            onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),
            onFinished('So, once again, after evaluating the expression, SP has increased by one and the result is on the top of the stack.'),
            onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
            onFinished('(go on stepping)'),
            onStepClicked(' '),
            onStepClicked('  '),
            onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),


            // 5 * 3 + 2
            onFinishedSetCodeAndAdvance(`int main() {
    5 * 3 + 2;
}`
            ),
            onFinishedCompileAndWrite(
                'What about "5 * 3 + 2"?'
            ),
            onFinished('(go ahead and step though the code)'),
            onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
            onFinished(' '),
            onStepClicked(' '),
            onFinished(' '),

            onStepClicked(' '),
            onStepClicked(' '),
            onStepClicked(' '),
            onStepClicked(' '),
            onStepClicked(' '),
            onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),
            onFinished('Again, the result is on the top of the stack, and our evaluation increased SP by 1 (from 30001 to 30002).'),
            onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
            onFinished('(go on stepping)'),
            onStepClicked(' '),
            onStepClicked('  '),
            onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),

            onFinished(
                'Because operators always sit between numbers in an expression, the number of operators of an expression is 1 less than the number of numbers, no matter how long the expression is.',
                'So there is always 1 less instruction that decreases SP (like PLUS), than the number of PUSHes. So it makes sense that, in the end, SP must be one more than it stared.'
            ),

            onChatClicked(
                'We can also see a pattern here: no matter what expression we give to the compiler, it just has to swap each operator with the number on its right, and then replace each number with "PUSH number" and the operator with its corresponding instruction. Let\'s see an example.',
            ),

            onChatClicked(
                '"5 * 3 + 2" becomes "5 3 * 2 +" (swapping), which is finally compiled to "PUSH 5, PUSH 3, TIMES, PUSH 2, PLUS". (replace)',
                '"5 3 * 2 +" is sometimes called the "reverse polish notation" of "5 * 3 + 2" (which is just a way of saying: "write the numbers, and then the operator, instead of sticking the operator between the numbers").',
                'For the compiler, this is perfect because it always has to know what the numbers are before adding them.',
                'Making use of the reverse polish notation is the typical way expressions are compiled in "stack-based machines" (machines that use a stack to evaluate expressions) like this one.'
            ),

            onChatClicked(
                'It is useful to view all the instructions generated from an expression as single instruction: "PUSH <expression-result>."',
                'What I mean by this is that the stack is in the same state after doing "PUSH 2, PUSH 3, PLUS" as after doing "PUSH 5".',
                'Both ways lead to a 5 being on the top of the stack and SP increased by 1.'
            ),

            onChatClicked(
                'The only difference is that after "PUSH 2, PUSH 3, PLUS", we will have a 5 at SP, but the 3 we pushed is still at SP + 1. ',
                'However, any address above SP we don\'t care about because the only thing that can happen to it is we are going to overwrite its value later with a PUSH.',
                'This is why SP is called "top of the stack". Everything higher than SP is just free space for the stack to grow if we ever use PUSH again.',
                'When SP decreases, it\'s like saying "We don\'t need that space right now, but we will later when we PUSH."'
            ),

            onChatClicked(
                'So we can say "PLUS 5" is equivalent (as far as the stack is concerned) with "PUSH 2, PUSH 3, PLUS", which is equivalent with "PUSH 1, PUSH 2, TIMES, PUSH 3, PLUS" which is equivalent with any expression that evaluates to 5, no matter how long.',
                'So this is the rationale of the compiler when generating the instructions that evaluate an expression.'
            ),

            // precedence

            onChatClicked(
                'We are not quite done yet, because our rule doesn\'t work so well on the expression "2 + 5 * 3".',
                'The reverse polish notation would be "2 5 + 3 *" and that would compile to "PUSH 2, PUSH 5, PLUS, PUSH 3, TIMES" which would evaluate to 21.',
                'But we all know that\'s wrong because the multiplication should be done before the addition. The correct way is 2 + 15 = 17.',
                'So let\'s see what this expression actually compiles to.'
            ),
            onChatClicked('  '),
            onFinishedSetHighLightAndAdvance(makeHighLights('adr10009')),
            onFinishedSetCodeAndAdvance(`int main() {
    return 2 + 5 * 3;
}`),
            onFinishedCompileAndWrite('The instruction PLUS was moved to the very end of the evaluation.'),
            onFinished(
                'What the compiler is thinking is : "First, "2" must be evaluated, then "5 * 3", and then their results must be added".',
                'So it just split the expression in two smaller ones ("2" and "5 * 3").',
                'It then generated the instructions to evaluate 2 ("PUSH 2") and then the instructions to evaluate "5 * 3" ("PUSH 5, PUSH 3, TIMES") and added a final PLUS instruction that will use the two results evaluate the whole expression.',
                'Let\'s see how this works.',
                '(click "Step" to continue)'
            ),
            onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
            onFinished(' '),
            onStepClicked(' '),
            onFinishedSetHighLightAndAdvance(makeHighLights()),
            onFinished(' '),
            onStepClicked('Now the first expression "2" has been evaluated.'),
            onFinished('(go on stepping)'),
            onStepClicked(' '),
            onStepClicked(' '),
            onStepClicked('And now the result of the second one is on the top of the stack, and we are ready to add them.'),
            onFinished('(go on stepping)'),
            onStepClicked(' '),
            onStepClicked('And we got our correct result, 17.'),

            onChatClicked('  '),
            onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),
            onChatClicked(
                'This is called "operator precedence".',
                'Each language has an operator "precedence table" that assigns a "precedence level" (which is just a number) to each operator.',
                'Operators "+" and "-" have the same precedence level, while "*" and "/" also have the same precedence, but a lower one.',
                'The compiler just uses this precedence table to generate instructions correctly.',
                'Let\'s see this in action.'
            ),

            onFinishedSetCodeAndAdvance(`

int main() {
    3 + 10 / 5 + 7 * 6 / 3 - 11;
}`),
            onFinished(' '),
            onChatClicked(
                'What should "3 + 10 / 5 + 7 * 6 / 3 - 11" compile to?',
                'We will use the reverse polish notation along the way and write the instructions at the end.',
                'Firstly, we look for the operators with the lowest precedence.',
                'The first one is "/", right after 10, so we start from 10 and stop at the first operator that has a higher precedence, the "+" after 5.',
                'We have now identified our first subexpression, "10 / 5", which we write (in reverse polish notation) as "10 5 /".',
            ),

            onChatClicked(
                'We then look for the next operator with the lowest precedence which is "*" (right after 7) and we stop at the next operator with a higher precedence, "-", and we get our second subexpression, "7 * 6 / 3", which we write as "7 6 * 3 /".',
                'We can now see our initial expression as "3 + subexpression1 + subexpression2 - 11", which we write as "3 subexpression1 + subexpression2 + 11 -".',
            ),

            onChatClicked(
                'We then substitute subexpression1 and subexpression2 with their reverse polish notations, and get the final expression "3 (10 5 /) + (7 6 * 3 /) + 11 -" (I marked the beginning and the end of the subexpressions with parenthesis to make it easier to understand).',
                'To compile this, we just have to replace numbers with PUSH and operators with their specific instructions."',
                'Our instructions are: "PUSH 3, (PUSH 10, PUSH 5, DIV), PLUS, (PUSH 7, PUSH 6, TIMES, PUSH 3, DIV), PLUS, PUSH 11, MINUS".'
            ),
            onFinishedChangeLockAndAdvance(makeLock(true, false, true, true)),

            onFinished('(click "Compile" to continue)'),

            onCompileClicked('And there we have it, exactly what we expected.'),
            onFinished(
                'There are many other operators with higher and lower levels of precedence, and we will learn them all along the way, but enough with expressions for now.'
            ),
            onChatClicked(
                'We have seen how the compiler uses the reverse polish notation to compile expressions of any size and then how precedence is handled. ',
                'Next time, we will look at other expressions such as "-(5 + 3) * 2", and then we move on to "variables".'
            ),
            onChatClickedToNextSection()
        ])),

        // part 3 - finishing expressions 

        addClickToContinues(flatten([

            onBubble('Oh, hi there! Glad you made it through.'),

            onChatClicked(
                'We learned a lot last time. Let\'s do a quick recap.',
                'First, we saw how the compiler handles expressions by translating them to the reverse polish notation and then to actual instructions.',
                'An expression like "3 * 5 + 2" is first translated to its reverse polish notation, "3 5 * 2 +".',
                'From there, each number maps to a PUSH instruction, and each operator to its specific instruction.',
                'So the expression finally compiles to: PUSH 3, PUSH 5, TIMES, PUSH 2, PLUS".'
            ),

            onChatClicked(
                'However, for an expression like "2 + 3 * 5" it\'s not quite as simple as translating to "2 3 + 5 *" and then to "PUSH 2, PUSH 3, PLUS, PUSH 5, TIMES".',
                'That would mean adding 2 and 3 before multiplying 3 and 5, which we all know is the wrong order.',
                'Because multiplication has a lower precedence than addition, the compiler recognizes that 3 and 5 should be multiplied first.'
            ),
            onChatClicked(
                'It actually thinks: "First, I will compile "2" (which is just "PUSH 2"), then "3 * 5" (which is just "PUSH 3, PUSH 5, TIMES) and then finish it up with a "PLUS".',
                'So, the whole expression actually compiles to "PUSH 2, PUSH 3, PUSH 5, TIMES, PLUS".',
            ),

            onChatClicked(
                'Expressions are the building blocks of programming languages.',
                'Every topic that comes after expressions is much easier to grasp conceptually, but it absolutely requires mastering expressions first.',
                'In this part, we will cover what\'s left of expressions and get ready for the next part: variables.',
            ),

            onChatClicked(
                'You may recall from last time that a valid expression is either a number or an expression followed by an operator and then another expression.',
                'However, it would be handy if we could compute "(2 + 3) * 5". Is this a valid expression?',
                'Well, yes. Actually, a "(" followed by an expression and then by a ")" is always a valid expression.',
                'So because "(2 + 3)" is valid, and because putting any operator between two expressions also makes a valid expression, then "(2 + 3) * 5" must also be valid.'
            ),

            onChatClicked(
                'As long as we follow the rules above, we can go wild with "(" and ")".',
                '"((2 + (((3)))) * 5)" is also a valid expression, even though a lot of the parenthesis are redundant.',
                'It can easily be simplified back to "(2 + 3) * 5". Now the questions is: how are parenthesis compiled?'
            ),

            onChatClicked(
                'Let\'s take the expression "2 * (11 + 13 * 15) - 50".',
                'Now let\'s imagine instead of "(11 + 13 * 15)" there was just its result which we don\'t even have to know, we can can call it X.',
                'So the expression would just be "2 * X - 50" which is written as "2 X * 50 -" in reverse polish notation and compiled to "PUSH 2, PUSH X, TIMES, PUSH 50, MINUS".',
                'Now everything the compiler has to do it just replace "PUSH X" with whatever "11 + 13 * 15" compiles to, which is "PUSH 11, PUSH 13, PUSH 15, TIMES, PLUS".',
                'And it gets "PUSH 2, PUSH 11, PUSH 13, PUSH 15, TIMES, PLUS, TIMES, PUSH 50, MINUS".'
            ),

            onChatClicked(
                'Let\'s quickly compile it just to make sure."',
            ),



            onFinishedChangeLockAndAdvance(makeLock(true, false, true, true)),
            onFinishedSetCodeAndAdvance(`int main() {
    2 * (11 + 13 * 15) - 50;
}`),
            onFinished('(click "Compile" to continue)'),
            onCompileClicked('And that is exactly what we expected.'),



            onChatClicked(
                'But can we always just replace "PUSH X" with whatever the expression inside the parenthesis (without breaking anything)?'
            ),

            onChatClicked(
                'Well, last time we made an important point.',
                'The instructions we get from compiling an expression are, as far as the stack (which is the only thing we care when evaluating expressions) is concerned, equivalent with the instruction "PUSH X", where X simply the number that the expression evaluates to.',
                'They are equivalent in the sense that no matter if "PUSH X" or the actual instructions get executed, SP will increase by 1 and the result will be on the top of the stack.'
            ),

            onChatClicked(
                'Generally speaking, evaluating any expression just ends up pushing its result on to the stack.',
                'So a set of instructions that evaluate an expression, can always be replaced by another set of instructions that evaluate another expression without any fear of breaking anything.',
                'This is good news for the complier because it can always just replace "PUSH X" with whatever the expression inside the parenthesis compiles to.',
                'And this is why it never worries about us going wild with "(" and ")".'
            ),

            onChatClicked(
                'And that\'s all about "(" and ")", nothing complicated going on.',
                'Just don\'t forget ")" if you previously wrote "(".',
                'What happens if we do forget? Let\'s try and compile the invalid expression "3 * (5 / (7 + 12)" (the "(" before 5 is never closed).'
            ),



            onFinishedSetCodeAndAdvance(`int main() {
    3 * (5 / (7 + 12);
}`),
            onFinished('(click "Compile" to continue)'),
            onCompileFailed('Oops. We haven\'t seen that one before.'),



            onChatClicked(
                'The compiler yells at us: ',
                '"parsing error: unexpected token: ;, line 1, column 28"',
                '"Expected CloseParenthesis"',
                'It likes this kind of technical language like most compilers do, but what it means by that is:',
                '"I was reading your code and got to line 1, column 28. You put a ";" there (which marks the end of the expression) but you can\'t end the expression before adding a CloseParenthesis (a ")" symbol).',
            ),

            onChatClicked(
                'Note that CloseParenthesis is just a suggestion, it doesn\'t mean that ")" is the only valid symbol that we can end the expression with. We might as well add " + 5)" and we would get a valid expression: "3 * (5 / (7 + 12) + 5)".'
            ),

            onChatClicked(
                'Now there is one thing you may have asked yourself by now... Aren\'t negative numbers valid too?',
                'What if we wanted to "return -2;"? Surely there must be a simpler way than something like "return 4 - 2;"',
                'Well, "-2" is actually a valid expression. Let\'s see what is compiles to.'),




            onFinishedSetCodeAndAdvance(`int main() {
    -2;
}`),
            onFinished('(click "Compile" to continue)'),
            onCompileClicked('Hmm, we haven\'t seen the OPP instruction before.'),




            onChatClicked(
                'OPP just multiplies the top of the stack with -1, effectively negating that number.',
                'Actually, we can write "-" before any expression and we get a valid expression, like in "-2 * 5".',
                'Because "-2" is itself an expression, we could even write another "-" (or many more) before it.'
            ),

            onChatClicked(
                '"----32 * -(2 + 3)" is also a valid expression. What do you expect it to compile to?',
                'Let\'s reason about it. We already know "32 * (2 + 3)" compiles to "PUSH 32, PUSH 2, PUSH 3, PLUS, TIMES", but what about all those minuses ?',
                'Well, a "-" before an expression (we call it "infix -") will generate an OPP instruction just after the expression that comes after.',
                'In "-(2 + 3)" for instance, the OPP will come after PLUS, which is the last instruction generated from "(2 + 3)".'),

            onChatClicked(
                'So let\'s get back to "----32 * -(2 + 3)".',
                'Following the rules above, those first 4 minuses should generate 4 OPPs right after 32, and the "-" before "(" should generate an OPP right the last instruction of the ,expression "2 + 3", which is PLUS.',
                'So we expect "PUSH 32, OPP, OPP, OPP, OPP PUSH 2, PUSH 3, PLUS, OPP, TIMES"',
                'Let\'s quickly compile that to check our reasoning.'
            ),



            onFinishedSetCodeAndAdvance(`int main() {
    ----32 * -(2 + 3);
}`),
            onFinished('(click "Compile" to continue)'),
            onCompileClicked('Yup, no magic tricks. Of course 4 OPPs in a row are useless, but there are other infix operators which we will learn shortly and it\'s important to know that you can put as many as you like behind an expression and it\'s still valid.'
            ),



            onChatClicked(
                'And that\'s all about infix -, there is nothing really special about it.',
                'If we take any expression, we know that evaluating it is equivalent to pushing the result on to the stack.',
                'And if there was a "-" before it in in the C code, there would also be an OPP instruction at the end, and that OPP would just change the sign of the value on the top of the stack.',
                'So by putting a "-" before any expression, evaluating its instructions would still end up pushing the result on to the stack, just like any other type of expression.'
            ),


            onChatClicked(
                'Before ending this part, there are a couple of things to clarify...'
            ),

            onChatClicked(
                'Unlike standard C, this machine and compiler to not work with with fractional numbers.',
                '2.5 is not a valid number here, but 2 is. That\'s because 2 is a whole number (or an "integer").',
                'Actually, fractional (or "floating point") numbers are so special that other machines have a whole subset of instructions made just for them.',
                'It\'s not really worth covering instructions like PLUSF which behave just like PLUS but with floating point numbers instead.'
            ),

            onChatClicked(
                'The reason different instructions are needed for floating point numbers will become clear in a later chapter, after we talk about bits and bytes.'
            ),

            onChatClicked(
                'Hmm. If there are no floating point numbers, what does "5 / 2" evaluate to ?',
                'Let\'s quickly check!'
            ),

            onFinishedChangeLockAndAdvance(makeLock(true, false, true, true)),
            onFinishedSetCodeAndAdvance(`int main() {
    return 5 / 2;
}`),
            onFinished('(click "Compile" to continue)'),
            onCompileClicked('Ok, now let\'s step through it.'),
            onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
            onFinished(''),
            onStepClicked(''),
            onStepClicked(''),
            onStepClicked('And now for the moment of truth...(go on stepping)'),
            onStepClicked('Oh. Instead of the expected 2.5, we get the "truncated" result, 2.'),
            onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),



            onChatClicked(
                'This is standard behavior for integers in C and all major programming languages.',
                'This behavior might seem annoying, but it actually has quite a few use cases. We will see one of them in the next part.'
            ),

            onChatClicked(
                'If we ever want to get the remainder of 5 / 2 we can always use the "%" ("modulus", or "mod") operator. "5 % 2" will evaluate to 1.',
                '% has the same precedence as * and /, so in "1 + 5 % 2", "5 % 2" is evaluated first to 1 and then 1 + 1 = 2 is the final result.'
            ),

            onChatClicked(
                'There are a few more operators which we will introduce throughout the rest of these tutorials (like "||", "&&" or "<").',
                'Their coresponding instructions will compute the result differently (otherwise there is no point) and they might have a different precedence levels.',
                'Other than that, they behave just like * or +.'
            ),


            onChatClicked(
                'Oh and one more thing...',
                'Expressions in other "stack-based" machines (machines that use the stack to evaluate expression, like Jasmine behind Java) work as described up until this point, but it is important to note that expressions can also be evaluated using registers.',
                'For instance, your CPU is a "register-based machine", the main difference being that it has more registers (not just IP, BP and SP...) and they are what is used to evaluate expressions.'
            ),

            onChatClicked(
                'For the expression "5 + 3 * 2", the compiler for a register machine must be smart enough to figure out number "5" goes in some register A and then the two other registers B and C can be used to evaluate "3 * 2", and only then the "2" in A and the result "8" in B are used to compute the final result.',
                'Register machines also have the problem of "register allocation".',
                'There is enough space for the stack to get really big, but there can only be a handful of registers, because they are very expensive to make.',
                'If the expression is really long and registers are not enough, the stack will have to be used at some point.'
            ),

            onChatClicked(
                'But why go through all this trouble and not just use the stack in the first place?',
                'Here\'s the catch: Registers (on Intel CPUs, at least) are always faster than the stack because they are built on to the CPU, but the stack is actually in RAM.',
                'This is why smart compilers that produce x86 instructions (that Intel CPUs understand) for example, try really hard to use the registers wisely.',
            ),

            onChatClicked(
                'For our machine however, compiling "5 + 3 * 2" will result in 3 PUSH instructions in a row.'
            ),
            onFinishedSetHighLightAndAdvance(makeHighLights('adr10002', 'adr10004', 'adr10006')),
            onFinishedSetCodeAndAdvance(`int main() {
    return 5 + 3 * 2;
}`),
            onFinishedCompileAndWrite('Which means SP will reach 10004.'),


            onChatClicked('But for "3 * 2 + 5", even though the result is the same, things are different.'),
            onFinishedSetHighLightAndAdvance(makeHighLights('adr10002', 'adr10004', 'adr10007')),
            onFinishedSetCodeAndAdvance(`int main() {
    return 3 * 2 + 5;
}`),
            onFinishedCompileAndWrite('Because there is a TIMES immediately after PUSH 3, PUSH 2, SP will only reach 10003, so less space is used to evaluate the expression.'),

            onFinished(
                'A compiler may sometimes spin expressions around like that if the resulting expression is equivalent.',
                'This idea becomes very important in register machines where the number of registers is limited.',
                'Moreover, in x86, the TIMES (called IMUL) and PLUS (called ADD) instructions work a bit differently because they use registers.'
            ),

            onChatClicked(
                'Here is some x86 (instructions with more than one argument are common in x86):',
                ' ',
                'MOV  EAX 3  (puts 3 in register EAX)',
                'IMUL EAX 2  (multiplies what is in EAX with 2)',
                'ADD  EAX 5  (add 5 to what is in EAX)',
                ' ',
                'So, with x86 instructions, the same expression can be evaluated using a single register.'
            ),

            onChatClicked(
                'OK, now we are really done with expressions.',
                'Let\'s quickly recap what are the key takeaways.'
            ),

            onChatClicked(
                '1. There are a handful of rules that describe what a valid expression can look like: it can be a number, an expression followed by an operator and then another expression, a "(" followed by an expression and then ")", or a "-" followed by an expression.',
                '2. Expressions can be compiled following some basic rules such as the reverse polish notation (which is specific to stack-based machines).'
            ),

            onChatClicked(
                '3. Expressions can get infinitely big, the only limitation is the stack size when evaluating them.',
                '4. All operators such as + or % follow the same rules, the only difference is their precedence level and what operation they perform (adding for +, getting the remainder of the division for %). We will introduce new operators along the way, so it\'s important to know that all operators have a language-specific precedence level that you can check whenever you are unsure of the order in which is an expression evaluated.'
            ),

            onChatClicked(
                'Remember that expressions are the building blocks of programming languages. Understand them and everything else is a piece of cake.',
                'Next time we will move on to variables and talk about program structure.'
            ),

            onChatClickedToNextSection()
        ])),

        // part 4 - variables and program structure
        
addClickToContinues(flatten([

onBubble(
	'Oh, so you are here for more. Let\'s get started!',
),

onChatClicked(
	'Up until this point, we had an in depth look at expressions.',
	'However, fundamental as they are, expressions are not enough to write most useful programs.',
),

onChatClicked(
	'Suppose we knew we had some numbers laid out one after the other at some memory location (perhaps someone on the internet had sent them).',
	'Further suppose we want to write a program to somehow process (just add them up, maybe) these numbers.',
	'It\'s actually impossible to write this kind of program with just expressions.',
),

onChatClicked(
	'Even if we knew a way to process each number one by one, where and how do we store the result?',
	'This is where "variables" come in. A variable is just a memory address we can use to store a number (and perhaps retrieve it later, otherwise there is no point).',
	'Let\'s have a look at some C code.',
),

onFinishedChangeLockAndAdvance(makeLock(true, false, true, true)),
onFinishedSetCodeAndAdvance(`int main() {
    int a = 3;
    return a + 5;
}`
),
onFinishedCompileAndWrite(' '),

onChatClicked(
	'By writing "int a = 3;" we "declare" and "initialize" a variable called "a".',
	'It\'s like saying: "I would like you to evaluate the expression 3 and store its result at some address. From now on, I\'ll call that address "a".',
),

onChatClicked(
	'We could have named our variable anything, including "lasagnas".',
	'The compiler doesn\'t actually care how we name our variables.',
	'The only thing it does is it counts the variable declarations and makes room on the stack (which means increasing SP once in the beginning) to store them.',
),

onChatClicked(
	'If it sees 3 variables "a", "b", and "c", it will just increase SP by 3 in the beginning.',
	'The compiler also remembers the order in which variables were declared, so when it later sees "b = 2;" it knows "where b is".',
	'In a moment, we will see exactly what it compiles to and how it\'s executed.',
),

onChatClicked(
	'In "int a = 3;", "int" is just an indicator that "a" represents an "integer" (that\'s a number without a fractional component. 0, and −2048 are integers, while 9.75 is not).',
	'Because the declaration starts with int, we can say that "the type of variable a is int".',
	'After "int a = 3;", the compiler will allow us to use "a" when evaluating an expression just as if "a" was a number.',
),

onChatClicked(
	'We could have specified a few other types other than "int", and compilers will behave a bit differently.',
	'We will explore these possibilities when we talk about bits and bytes.',
),

onChatClicked(
	'Finally, it\'s time to step through the example.',
	'Here, we just declare a variable a and set its initial value to 3.',
	'Then, evaluate the expression "a + 5" and expect it to return the correct result, 8.',
),

onChatClicked(
	'Notice that instead of our usual first instruction "FSTART 0", the compiler has now generated "FSTART 1".',
	'Let\'s execute it and see what happens.',
),

onFinished('(click the step button to continue)'),
onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
onFinished(' '),
onStepClicked(' '),
onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),

onChatClicked(
	'After "FSTART 0", both BP and SP would point to address 30001, but with "FSTART 1", SP now points to 30002.',
	'What\'s going on here?',
),

onChatClicked(
	'The compiler found 1 variable declaration and that\'s why it changed the argument of FSTART from 0 to 1.',
	'But why?',
),

onChatClicked(
	'You may recall that after evaluating any expression, SP will be one more than it started (from 30002 to 30003 and the result will be at (30003).',
	'This is true for any expression, as we have seen last time.',
	'So the compiler generated FSTART 1 to make room for variable a which will be stored at 30002.',
	'It is effectively making sure that while expressions that may follow are evaluated, all addresses lower than 30002 will not be modified.',
),

onChatClicked(
	'If we want one variable, it is stored 30002 and 30003 is the first address used for evaluating expressions.',
	'If we needed 2 variables, they would be stored at 30002 and 30003 and 30004 would be the first address used for evaluating expressions.',
	'And so on...',
),

onChatClicked(
	'Notice that FSTART only changed SP, but not BP.',
	'BP always points to 30001. (Now you might ask yourself why we need BP at all. We\'ll get to that.).',
	'Therefore, the first variable is at BP + 1, the second at BP + 2, and so on...',
	'The next instruction is LEA 1, will just compute "BP + 1" (30002) and push it on to the stack ("LEA 2" would just push "BP + 2" and so on...).',
	'After "LEA 1", the expression "3" was compiled to "PUSH 3", as expected.',
	'Finally, the instruction "ASSIGN" will copy the value at SP (which will be 3) to address SP - 1 (which will be BP + 1 = 30002).',
	'And this is exactly what we wanted with our "int a = 3;".',
),

onChatClicked(
	'Aha! So BP is used when working with variables.',
	'No matter how many variables there are, BP + 1 points to the first, BP + 2 to the second and so on...',
	'But I just said BP always points to 30001.',
	'Why can\'t "int a = 3" simply be compiled to something like "PUSH 3, ASSIGNTO 30002"?.',
	'Wouldn\'t that be much easier?',
),

onChatClicked(
	'Well, as long as soon we start using multiple functions, BP won\'t always point to 30001.',
	'And that\'s because of "recursion", which is something special can be done with functions.',
	'After seeing how recursion works the reason will become clear.',
),

onChatClicked(
	'For now we must accept that variable addresses are not constant, so "ASSIGNTO 30002" is not an option.',
	'However, even with recursion, the first variable is at BP + 1, the second at BP + 2, and so on...',
	'It\'s just that BP is not always 30001, it depends on the order in which functions are called and how deep the recursion is.',
	'Again, this can only be understood after knowing how functions work.',
	'For now though, let\'s execute the next instruction: "LEA 1".',
),

onFinished('(click the step button to continue)'),
onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
onFinished(' '),
onStepClicked(' '),
onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),

onChatClicked(
	'"LEA 1" adds 1 to BP and pushes the result.',
	'Now we find 30002 (the address of our variable a) on the stack.',
	'Address 30002 needs to be on the stack because instruction ASSIGN is going to store a number there.',
	'3 is now pushed onto the stack.',
),

onFinished('(click the step button to continue)'),
onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
onFinished(' '),
onStepClicked(' '),
onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),

onChatClicked(
	'Instruction ASSIGN will pop the value at SP and copy it at BP + 1.',
	'This is what we were after, storing the number 3 in a variable.',
	'But ASSIGN will also copy the value at SP to SP - 1. Why?',
),

onChatClicked(
	'Well, "a = 3" is just an expression (an "assignment expression", specifically) and with "int a = 3;", we aren\'t doing anything more than evaluate it.',
	'Like all expressions we have seen so far, after evaluation, the result has to be on the top of the stack and SP will have increased by 1.',
),

onChatClicked(
	'The assignment expression behaves just like any other expression, but it has the "side effect" of storing a number at an address.',
	'If that seems a bit weird for what expressions are meant to do, you are definitely not alone.',
	'There is actually an entire class of "purely functional" programming languages that forbids expressions with side effects and are very serious about side effects in general.',
	'However, C was never meant to be a purely functional language.',
),

onFinished('(click the step button to continue)'),
onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
onFinished(' '),
onStepClicked(' '),
onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),

onChatClicked(
	'Now, since the expression has been evaluated, its result is thrown away by POP, effectively resetting SP to 30002, and preparing to evaluate more expressions.',
),

onFinished('(click the step button to continue)'),
onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
onFinished(' '),
onStepClicked(' '),
onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),

onChatClicked(
	'"return a + 5;" is now going to retrieve 3 (from the address of a add 5 to it and return the result, 8.',
	'LEA 1, is used again to push the address 30002 on the stack.',
),

onFinished('(click the step button to continue)'),
onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
onFinished(' '),
onStepClicked(' '),
onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),

onChatClicked(
	'The next instruction, DRF will "dereference" the address on the top of the stack, which means nothing more than replacing the address with the number stored at that address.',
),

onFinished('(click the step button to continue)'),
onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
onFinished(' '),
onStepClicked(' '),
onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),

onChatClicked(
	'Up until this point, LEA 1 and DRF did nothing more than evaluate the expression "a".',
	'Next, PUSH 5 and PLUS are used to evaluate a + 5 and RET 0 will just return the result, 8.',
),

onFinished('(click the step button to continue)'),
onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
onFinished(' '),
onStepClicked(' '),
onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),
onFinished('(click the step button to continue)'),
onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
onFinished(' '),
onStepClicked(' '),
onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),
onFinished('(click the step button to continue)'),
onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
onFinished(' '),
onStepClicked(' '),
onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),

onChatClicked(
	'Now we see that working with variables is not much different than expressions.',
	'To store a value at an address, we use an assignment expression, like "a = 3".',
	'The assignment expression will first evaluate a smaller expression (what\'s on the right side of "=") and then store it at a memory address.',
	'To get the address of our n-th variable, the compiler generates LEA n (in our case, n was 1 because we had just 1 variable).',
	'ASSIGN then does all the magic: reads the value at SP and writes it to the address found at SP - 1 (and to SP - 1 itself...hmm...why?).',
),

onChatClicked(
	'Because "a = 3" leaves the the result 3 on the top of the stack, 3 could be reused (and not just popped immediately) if "a = 3" is part of a longer expression.\'.',
	'For instance, this is how "b = a = 5;" is compiled.',
),

onFinishedChangeLockAndAdvance(makeLock(true, false, true, true)),
onFinishedSetCodeAndAdvance(`int main() {
    int a = 3;
    int b = a = 5;
    return b;
}`
),
onFinishedCompileAndWrite(' '),

onChatClicked(
	'In this case, after evaluating "a = 5", the result 5 is not popped immediately.',
	'Instead, it is also copied to the address of variable b by the other ASSIGN that follows.',
	'ASSIGN doesn\'t know what\'s the next instruction, so it always copies the value at SP to SP - 1, just in case.',
	'Let\'s execute this.',
),

onFinished('(click the step button to continue)'),
onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
onFinished(' '),
onStepClicked(' '),
onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),

onChatClicked(
	'Notice that now there are two variables, so FSTART 2 was generated and SP now points to 30003, the address of last variable, b.',
),

onFinished('(click the step button to continue)'),
onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
onFinished(' '),
onStepClicked(' '),
onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),
onFinished('(click the step button to continue)'),
onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
onFinished(' '),
onStepClicked(' '),
onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),
onFinished('(click the step button to continue)'),
onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
onFinished(' '),
onStepClicked(' '),
onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),
onFinished('(click the step button to continue)'),
onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
onFinished(' '),
onStepClicked(' '),
onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),

onChatClicked(
	'"int b = a = 5;" first assigns a to 5 and and then b to a, so both variables will hold 5.',
	'It all happens in a single expression.',
),

onFinished('(click the step button to continue)'),
onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
onFinished(' '),
onStepClicked(' '),
onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),
onFinished('(click the step button to continue)'),
onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
onFinished(' '),
onStepClicked(' '),
onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),
onFinished('(click the step button to continue)'),
onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
onFinished(' '),
onStepClicked(' '),
onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),
onFinished('(click the step button to continue)'),
onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
onFinished(' '),
onStepClicked(' '),
onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),

onChatClicked(
	'Now the 5 that was left on the stack from the previous ASSIGN will be used by this next one.',
),

onFinished('(click the step button to continue)'),
onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
onFinished(' '),
onStepClicked(' '),
onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),
onFinished('(click the step button to continue)'),
onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
onFinished(' '),
onStepClicked(' '),
onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),

onChatClicked(
	'And finally, we return the result.',
),

onFinished('(click the step button to continue)'),
onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
onFinished(' '),
onStepClicked(' '),
onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),
onFinished('(click the step button to continue)'),
onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
onFinished(' '),
onStepClicked(' '),
onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),
onFinished('(click the step button to continue)'),
onFinishedChangeLockAndAdvance(makeLock(true, true, false, true)),
onFinished(' '),
onStepClicked(' '),
onFinishedChangeLockAndAdvance(makeLock(true, true, true, true)),

onChatClicked(
	'Some compilers (including this one) let you leave a variable "uninitialized".',
	'This means that you can simply write "int a;", without specifying an initial value.',
	'If we then immediately try to evaluate "a + 5", we are not sure of what the result will be.',
	'In this simple example, there was going to be a 0 there, but it\'s not a good idea to rely on that.',
	'If a long expression was previously evaluated, it might have left any number at the memory location that we call "a".',
),

onChatClicked(
	'This is why leaving a variable uninitialized is bad practice.',
	'You can easily forget to initialize it before using it in an expression.',
	'Some compilers forbid using an uninitialized variable altogether.',
),

onChatClicked(
	'Now, Before using variables in a more practical way, let\'s have an overview the structure of a C program (so far).',
	'A program is just a bunch of C code that can be compiled and executed. Everything that we\'ve written in the first column so far is a valid C program.',
	'Any program is made of at least one function. A function is just a series of instructions one after the other.',
	'We will cover all the details of functions later, but I just want to give you an overview.',
),

onChatClicked(
	'You can think of functions as tasks. The point is to "call" a function (set IP to its first instruction let it execute, and then the instruction "RET" will set IP back to where it was called from.\',.',
	'This way, if we want to compute the sum of the 5 numbers at addresses 40035-40039, we can call a function "sum" with arguments 40035 and 5, and it will return the sum.',
	'Again, don\'t worry if this isn\'t clear. At this point, it shouldn\'t.',
),

onChatClicked(
	'Having a function like sum is useful because we can call it with any 2 arguments and it will work.',
	'Whenever we want to compute the sum of some numbers that come one after the other in memory, we can call sum.',
	'The advantage is that we only write the code that actually computes the sum once, and if we ever change our mind and decide it should only compute the sum all all odd numbers, we only have to change what inside that function.',
),

onChatClicked(
	'This might not seem like such a big deal, but in large program it\'s nice to be able to break it down into smaller pieces.',
	'It\'s even better if functions can be reused in other parts of the program or in other programs.',
),

onChatClicked(
	'By writing "int main() {", we tell the compiler that what follows are the instructions of function "main".',
	'"int" means that the function returns a number (we will see what else it can return).',
	'Inside "()" we could specify some arguments for the function, but here, there are none.',
	'We mark the end of function main with a "}".',
),

onChatClicked(
	'The function "main" is always required. Before a program starts executing, IP is set by the compiler (by convention) to the address of the first instruction of function main. If main is not found, the code will not compile.\',.',
	'So far in our examples we only had function main, so IP was always set to 0 before execution.',
),

onChatClicked(
	'The elements inside functions are called "statements".',
	'In the beginning, there was no compiler, so programmers had to work directly with instructions like PUSH and PLUS.',
	'However, you can only write "LEA 1, PUSH 0, ASSIGN, POP" so many times before going insane.',
),

onChatClicked(
	'One of the reasons why compilers are nice is because we can write "int a = 0;" instead of the 4 instructions above.',
	'It\'s much easier to both read and write.',
),

onChatClicked(
	'A function can have any number of statements, in any order(with some exceptions which we\'ll cover).',
),

onChatClicked(
	'A type of statement we have seen is the "expression statement" (like "2 + 2;").',
	'It just means: "Let\'s evaluate this expression and then you can throw away the result. I don\'t care about it.',
	'Why would you ever bother evaluating an expression if you don\'t care about the result?',
	'If evaluating the expression also had a side effect (like "a = 3"), you would.',
),

onChatClicked(
	'Compiling an expression statement will always generate the instructions to evaluate the expression plus the additional POP instruction at the end and effectively throws the result away. This way, after the expression statement is executed, SP will always be in the same place it started from.\'.',
),

onChatClicked(
	'"int a = 0;" is also statement, more specifically a "variable declaration statement".',
	'We saw that it compiles identically to "a = 0;", the only difference is that we have FSTART 1 instead of FSTART 0 at the beginning of the function to make room for variable a.',
	'We could leave a uninitialized and just write "int a;", but that is generally bad practice.',
	'";" indicates the end of the statement.',
),

onChatClicked(
	'We\'ve also seen the "return statement" (like "return 2;").',
	'It is much like the expression statement, but instead of throwing the result away, it returns that result (from the function).',
	'Returning from function main (like we did up until now) will just end the program.',
),

onChatClicked(
	'In the variable declarations we saw earlier, "int" is called a "keyword". "return" is also a keyword (You can tell from their blue color).',
	'The compiler has a fixed set of keywords like int and return and we are going to learn them along the way.',
	'Note that we cannot name a variable "int" for instance.',
	'We can try to write "int int = 3;", but the compiler will just tell us that "int" is a keyword and that it didn\'t expect one right after the first "int".',
),

onFinishedChangeLockAndAdvance(makeLock(true, false, true, true)),
onFinishedSetCodeAndAdvance(`int main() {
    int int = 3;
}`
),
onFinishedCompileAndWrite(' '),

onChatClicked(
	'That\'s because the compiler does not want to be smart enough to figure out that "int" might mean different things in different places.',
	'The compiler would have to do a lot of work just so we can name our variables "int", which is not game-changing in any particular way.',
),

onChatClicked(
	'Another common error is using a variable before declaring it, like so.',
),

onFinishedChangeLockAndAdvance(makeLock(true, false, true, true)),
onFinishedSetCodeAndAdvance(`int main() {
    int b = a + 5;
    int a = 3;
    return b;
}`
),
onFinishedCompileAndWrite(' '),

onChatClicked(
	'"unknown identifier a", the compiler says.',
	'Once it saw a the first time (in "a + 5"), it realized a was never declared it stopped looking at the next lines.',
	'We will see some more common compiler errors in a later section.',
),

onChatClicked(
	'In this part, we have seen what a variable is, how assignment expressions work, and how a C program is structured (briefly).',
	'Next time we learn about the while and if statements and use variables to do more useful things.',
),

onChatClickedToNextSection()

]))

    ]

    const script = scripts[window.location.search.substr(1)] || { noScript: true }
}