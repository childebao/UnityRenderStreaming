import * as websocket from "ws";
import { Server } from 'http';
import { v4 as uuid } from 'uuid';
import Offer from './class/offer';
import Answer from './class/answer';
import Candidate from './class/candidate';

// [{sessonId:[connectionId,...]}]
const clients: Map<WebSocket, Set<string>> = new Map<WebSocket, Set<string>>();

// [{connectionId:[sessionId1, sessionId2...]}]
const connections: Map<string, Set<WebSocket>> = new Map<string, Set<WebSocket>>();

// [{connectionId:[connectionId1, connectionId2]}]
const connectionPair: Map<string, [string, string]> = new Map<string, [string, string]>();

// [{connectionId:[{connectionId:Candidate},...]}]
const candidates: Map<string, Map<string, Candidate[]>> = new Map<string, Map<string, Candidate[]>>();


function getOrCreateSessionIds(connectionId: string): Set<WebSocket> {
    let sessionIds = null;
    if (!connections.has(connectionId)) {
        sessionIds = new Set<WebSocket>();
        connections.set(connectionId, sessionIds);
    }
    sessionIds = connections.get(connectionId);
    return sessionIds;
}

export default class WSSignaling {
    server: Server;
    wss: websocket.Server;
    isPrivate: boolean;

    constructor(server: Server, mode: string) {
        this.server = server;
        this.wss = new websocket.Server({ server });
        this.isPrivate = mode === "private";

        this.wss.on('connection', (ws: WebSocket) => {

            clients.set(ws, new Set<string>());

            ws.onclose = (_event: CloseEvent) => {
                clients.delete(ws);
            }

            ws.onmessage = (event: MessageEvent) => {

                // JSON Schema expectation
                // type: connect, disconnect, offer, answer, candidate
                // from: from connection id
                // to: to connection id
                // data: any message data structure

                const msg = JSON.parse(event.data);
                if (!msg || !this) {
                    return;
                }

                console.log(msg);

                switch (msg.type) {
                    case "connect":
                        this.onConnect(ws, msg);
                        break;
                    case "disconnect":
                        this.onDisconnect(ws, msg);
                        break;
                    case "offer":
                        this.onOffer(ws, msg);
                        break;
                    case "answer":
                        this.onAnswer(ws, msg);
                        break;
                    case "candidate":
                        this.onCandidate(ws, msg);
                        break;
                    default:
                        break;
                }
            };
        });
    }

    private onConnect(ws: WebSocket, message: any) {
        const connectionId: string = message.from as string;
        const sessionIds = getOrCreateSessionIds(connectionId);
        sessionIds.add(ws);
        ws.send(JSON.stringify({ from: connectionId, to: connectionId, type: "connect" }));
    }

    private onDisconnect(ws: WebSocket, message: any) {
        const connectionId: string = message.from as string;

        if (connectionPair.has(connectionId)) {
            connectionPair.get(connectionId).forEach(id => {
                if (connections.has(id)) {
                    connections.get(id).forEach(session => {
                        session.send(JSON.stringify({ from: connectionId, to: id, type: "disconnect" }));
                    });
                }
            });
        }

        connections.delete(connectionId);
        connectionPair.delete(connectionId);
    }

    private onOffer(ws: WebSocket, message: any) {
        const from = message.from as string;
        const to = message.to as string;
        const newOffer = new Offer(message.data.sdp, Date.now());

        connectionPair.set(message.data.connectionId, [from, null]);

        if (this.isPrivate) {
            const sessionIds = connections.get(to);
            sessionIds.forEach(session => {
                session.send(JSON.stringify({ from: from, to: to, type: "offer", data: newOffer }));
            })
            return;
        }

        clients.forEach((_v, k) => {
            k.send(JSON.stringify({ from: from, to: "", type: "offer", data: newOffer }));
        });
    }

    private onAnswer(ws: WebSocket, message: any) {
        const from = message.from as string;
        const to = message.to as string;
        const connectionId = message.data.connectionId;
        connectionPair.set(connectionId, [to, from]);

        const mapCandidates = candidates.get(to);
        if (mapCandidates) {
            const arrayCandidates = mapCandidates.get(connectionId);
            for (const candidate of arrayCandidates) {
                candidate.datetime = Date.now();
            }
        }

        const sessionIds = connections.get(to);
        const newAnswer = new Answer(message.data.sdp, Date.now());
        sessionIds.forEach(session => {
            session.send(JSON.stringify({ from: from, to: to, type: "answer", data: newAnswer }))
        })
    }

    private onCandidate(ws: WebSocket, message: any) {
        const from = message.from;
        const to = message.to;
        const connectionId = message.data.connectionId;

        if (!candidates.has(connectionId)) {
            candidates.set(connectionId, new Map<string, Candidate[]>());
        }
        const map = candidates.get(connectionId);
        if (!map.has(from)) {
            map.set(from, []);
        }
        const arr = map.get(from);

        const data = message.data;
        const candidate = new Candidate(data.candidate, data.sdpMLineIndex, data.sdpMid, Date.now());
        arr.push(candidate);

        const sessionIds = connections.get(to);

        // const sendArr = candidates.get(connectionId);
        // const pair = connectionPair.get(connectionId);
        // const a = from === pair[0] ? pair[1] : pair[0];
        // const array = sendArr.get(a).filter(v => v.datetime > Date.now()).map(v => new Candidate(data.candidate, data.sdpMLineIndex, data.sdpMid, Date.now()));

        if(sessionIds){
            sessionIds.forEach(session => {
                session.send(JSON.stringify({ from: from, to: to, type: "candidate", data: candidate }));
            });    
        }
    }
}