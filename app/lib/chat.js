'use strict';

let Chat = {
    createNew: () => {
        Chat.isReady = false;
        let localStream = '';
        let fileChannels = {};
        let msgChannels = {};
        //取得使用者端的影像
        Chat.getUserMedia = (changeVideoReadyState, gotLocalVideo) => {
            navigator.mediaDevices.getUserMedia({
                    audio: true,
                    video: true
                })
                .then((stream) => {
                    var track = stream.getTracks()[0];
                    alert(track);
                    let videoURL = window.URL.createObjectURL(stream);
                    changeVideoReadyState();
                    gotLocalVideo(videoURL);
                    localStream = stream;
                })
                .catch((e) => {
                    console.log('發生錯誤了看這裡:' + e);
                });
        };

        Chat.toggleUserMedia = () => {
            if (localStream) {
                localStream.getTracks().forEach((track) => { track.stop(); });
            }
        };

        //建立點對點連線物件，以及為連線標的創建影像視窗
        Chat.createPeerConnection = (isInitiator, config, remotePeer, socket, videoTag) => {
            let peerConn = new RTCPeerConnection(config);
            if (localStream) {
                peerConn.addStream(localStream);
            }

            // send any ice candidates to the other peer
            peerConn.onicecandidate = (event) => {
                if (event.candidate) {
                    console.log('local端找到ice candidate>要傳出去: ' + JSON.stringify(event.candidate));
                    socket.emit('onIceCandidate', event.candidate, localUserID, remotePeer);
                }
            };

            peerConn.onaddstream = (event) => {
                console.log('Remote stream added.');
                videoTag.srcObject = event.stream;
            };

            peerConn.onremovestream = (event) => {
                console.log('Remote stream removed. Event: ', event);
            };

            //如果是開啟P2P的人
            if (isInitiator) {
                console.log('Creating Data Channel');
                //建立資料傳送頻道、訊息傳送頻道
                let fileChannel = peerConn.createDataChannel('files');
                let msgChannel = peerConn.createDataChannel('messages');
                fileChannels[remotePeer] = fileChannel;
                msgChannels[remotePeer] = msgChannel;

                //建立成功後，立即處理
                onDataChannelCreated(fileChannel);
                onDataChannelCreated(msgChannel);

                // //開啟通道後，初始化download物件
                // downloadAnchor.textContent = '';
                // downloadAnchor.removeAttribute('download');
                // if (downloadAnchor.href) {
                //     //停止連結的引用/作用
                //     URL.revokeObjectURL(downloadAnchor.href);
                //     downloadAnchor.removeAttribute('href');
                // }
            } else {
                //如果不是開房的，是加入別人的房間
                //如果有連線成功，會接到這個事件
                peerConn.ondatachannel = (event) => {
                    console.log('ondatachannel:', event.channel.label);
                    //加入別人建立的頻道
                    if (event.channel.label == 'files') {
                        //開啟通道後，初始化HTML元素
                        // downloadAnchor.textContent = '';
                        // downloadAnchor.removeAttribute('download');
                        // if (downloadAnchor.href) {
                        //     URL.revokeObjectURL(downloadAnchor.href);
                        //     downloadAnchor.removeAttribute('href');
                        // }
                        // let fileChannel = event.channel;
                        // fileChannels[remotePeer] = fileChannel;
                        // console.log('joined channel' + event.channel.label);
                        // onDataChannelCreated(fileChannel);
                    } else if (event.channel.label == 'messages') {
                        let msgChannel = event.channel;
                        msgChannels[remotePeer] = msgChannel;
                        console.log('joined channel' + event.channel.label);
                        onDataChannelCreated(msgChannel);
                    }
                };
            }
            return peerConn;
        };

        //建立資料傳遞頻道後，立即處理的函數
        let onDataChannelCreated = (channel) => {
            channel.onopen = () => {
                console.log('channel: ' + channel.label + ' is now opened!!!');
            };
            channel.onmessage = (event) => {
                if (channel.label == 'files') {
                    console.log(event.data);
                    if (typeof event.data === 'string') {
                        let received = new window.Blob(receiveBuffer);
                        receiveBuffer = [];
                        fileContainer = URL.createObjectURL(received);
                    }
                    //把每個ArrayBuffer都存在同一個陣列裡
                    receiveBuffer.push(event.data); //把資料push進陣列
                } else if (channel.label == 'messages') {
                    msgContainer = event.data;
                }
            };
        };

        Chat.sendText = (value, localUserID) => {
            if (!value) {
                alert('你不打字我是要傳什麼，是不是沒被揍過');
                return;
            }
            //取得現在時間
            let date = new Date();
            //自定義時間格式:Hour-Minute
            let formattedTime = date.getHours() + ':' + date.getMinutes();

            for (let id in msgChannels) {
                msgChannels[id].send(localUserID + '[' + formattedTime + ']: ' + value);
            }
            return ('localUserID + '[' + formattedTime + ']: ' + value');
        };

        Chat.sendFileToUser = (files) => {
            if (!files) {
                alert('沒有給我檔案我生77喔!');
                return;
            }
            //這個功能是直接將檔案廣播給房內的人，沒有存進資料庫
            //假設一次上傳多個檔案，files[0]指的是第一個傳的檔案
            //這裡暫時只做單一檔案上傳功能
            //webrtc的data channel一次最多只能傳送16*1024Bytes的檔案
            let file = files;
            console.log('File is ' + [file.name, file.size, file.type, file.lastModifiedDate].join(', '));

            let chunkSize = 16384;
            //切割檔案的，並傳入起始點，從頭開始切
            let sliceFile = (offset) => {
                //讀取<input>中的檔案
                let reader = new window.FileReader();
                //讀取完成時觸發此函數
                reader.onload = (e) => {
                    //把讀取好的檔案透過fileChannel傳送給「所有」遠端使用者
                    for (let id in fileChannels) {
                        //e.target.result是一個ArrayBuffer，長度為:16384bytes，把他送給遠端使用者
                        fileChannels[id].send(e.target.result);
                        //如果檔案總大小>0+16384>再呼叫一次sliceFile(0+16384+16384+...)>遞迴
                        if (file.size > offset + e.target.result.byteLength) {
                            window.setTimeout(sliceFile, 0, offset + chunkSize);
                        } else {
                            fileChannels[id].send(JSON.stringify({
                                'fileName': file.name,
                                'fileSize': file.size,
                                'fileType': file.type
                            }))
                        }
                    }
                };
                //從檔案開頭，切一塊16384的檔案下來
                let slice = file.slice(offset, offset + chunkSize);
                reader.readAsArrayBuffer(slice);
            };
            sliceFile(0);
        };


        Chat.sendFileToDB = (localUserID, files) => {
            //假設一次上傳多個檔案，files[0]指的是第一個傳的檔案
            //這裡只做單一檔案上傳功能
            let file = files;
            console.log('File is ' + [file.name, file.size, file.type, file.lastModifiedDate].join(', '));
            let reader = new window.FileReader();
            reader.onload = (e) => {
                let xhr = new XMLHttpRequest();
                xhr.open("POST", "https://140.123.175.95:8787/api/db/create/photo", true);
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.send(JSON.stringify({
                    id: localUserID,
                    data: e.target.result
                }));
            };
            reader.readAsDataURL(file);
        };
        return Chat;
    }
};

module.exports = Chat;
