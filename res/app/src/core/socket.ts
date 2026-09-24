import {useEffect, useRef} from 'react'
import {io, type Socket} from 'socket.io-client'
import {appState} from './app-state'

let instance: Socket | null = null

export function getSocket(): Socket {
  if (!instance) {
    instance = io(appState.config.websocketUrl || '', {
      reconnection: false
      , transports: ['websocket']
    })
  }
  return instance
}

export function emit(event: string, ...args: unknown[]): void {
  getSocket().emit(event, ...args)
}

export function onSocket(event: string, handler: (...args: any[]) => void): () => void {
  const socket = getSocket()
  socket.on(event, handler)
  return () => {
    socket.off(event, handler)
  }
}

export function useSocketEvent(event: string, handler: (...args: any[]) => void): void {
  const ref = useRef(handler)
  ref.current = handler

  useEffect(() => onSocket(event, (...args: any[]) => ref.current(...args)), [event])
}
