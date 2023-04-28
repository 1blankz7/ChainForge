import React, { useEffect, useState, useCallback } from 'react';
import { Handle } from 'react-flow-renderer';
// import { shallow } from 'zustand/shallow';
import useStore from './store';
import { render } from '@testing-library/react';

const PromptNode = ({ data, id }) => {

  // Get state from the Zustand store:
  const edges = useStore((state) => state.edges);
  const output = useStore((state) => state.output);

  const genStatusIcon = (status) => {
    switch (status) {
        case 'warning':  // Display mustard 'warning' icon
            return (
                <div className="status-icon warning-status">&#9888;<span className='status-tooltip'>Contents changed. Downstream results might be invalidated. Press Play to rerun.</span></div>
            );
        case 'ready':  // Display green checkmark 'ready' icon
            return (
                <div className="status-icon ready-status">&#10004;<span className='status-tooltip'>Responses collected and ready.</span></div>
            );
        case 'error':  // Display red 'error' icon
            return ( 
                <div className="status-icon error-status">&#10006;<span className='status-tooltip'>Error collecting responses. Check console for more info.</span></div>
            );
        case 'loading':  // Display animated 'loading' spinner icon 
            return (
                <div className="lds-ring"><div></div><div></div><div></div><div></div></div>
            );
        default:
            return []
    }
  }

  const [hovered, setHovered] = useState(false);
  const [templateHooks, setTemplateHooks] = useState([]);
  const [templateVars, setTemplateVars] = useState([]);
  const [promptText, setPromptText] = useState(data.prompt);
  const [promptTextOnLastRun, setPromptTextOnLastRun] = useState([]);
  const [selectedLLMs, setSelectedLLMs] = useState(['gpt3.5']);
  const [status, setStatus] = useState('none');
  const [statusIcon, setStatusIcon] = useState(genStatusIcon(status));
  
  const handleMouseEnter = () => {
    setHovered(true);
  };
  
  const handleMouseLeave = () => {
    setHovered(false);
  };

  const genTemplateHooks = (temp_var_names, names_to_blink) => {
    return temp_var_names.map(
        (name, idx) => {
            const className = (names_to_blink.includes(name)) ? 'text-blink' : '';
            const pos = (idx * 35) + 140 + 'px';
            const style = { top: pos,  background: '#555' };
            return (
                <div key={name} className={className} >
                <p>{name}</p>
                <Handle
                    type="target"
                    position="left"
                    id={name}
                    style={style}
                />
                </div>
            )
        }
    );
  };

  const handleInputChange = (event) => {
    const value = event.target.value;

    // Store prompt text
    setPromptText(value);

    // Update status icon, if need be:
    if (status !== 'warning' && value !== promptTextOnLastRun) {
        setStatus('warning');
        setStatusIcon(genStatusIcon('warning'));
    } else if (status === 'warning' && value === promptTextOnLastRun) {
        setStatus('ready');
        setStatusIcon(genStatusIcon('ready'));
    }

    const braces_regex = /(?<!\\){(.*?)(?<!\\)}/g;  // gets all strs within braces {} that aren't escaped; e.g., ignores \{this\} but captures {this}
    const found_template_vars = value.match(braces_regex);
    if (found_template_vars && found_template_vars.length > 0) {
        const temp_var_names = found_template_vars.map(
            name => name.substring(1, name.length-1)
        )
        setTemplateVars(temp_var_names);
        setTemplateHooks(
            genTemplateHooks(temp_var_names, [])
        );
    } else {
        setTemplateHooks([]);
    }
  };

  const handleRunClick = (event) => {
    // Go through all template hooks (if any) and check they're connected:
    const is_fully_connected = templateHooks.every(hook => {
        // Check that some edge has, as its target, this node and its template hook:
        return edges.some(e => (e.target == id && e.targetHandle == hook.key));
    });

    // console.log(templateHooks);

    if (is_fully_connected) {
        console.log('Connected!');

        // Check that there is at least one LLM selected:
        if (selectedLLMs.length === 0) {
            alert('Please select at least one LLM to prompt.')
            return;
        }

        // Set status indicator
        setStatus('loading');
        setStatusIcon(genStatusIcon('loading'));

        // Pull data from each source:
        const pulled_data = {};
        templateHooks.forEach(hook => {
            // Find the relevant edge (breaking once we've found it):
            for (let i = 0; i < edges.length; i++) {
                const e = edges[i];
                if (e.target == id && e.targetHandle == hook.key) {
                    // Get the data output for that handle on the source node:
                    let out = output(e.source, e.sourceHandle);
                    if (!Array.isArray(out)) out = [out];
                    if (hook.key in pulled_data)
                        pulled_data[hook.key] = pulled_data[hook.key].concat(out);
                    else
                        pulled_data[hook.key] = out;
                }
            }
        });

        // Get Pythonic version of the prompt, by adding a $ before any template variables in braces:
        const py_prompt_template = promptText.replace(/(?<!\\){(.*?)(?<!\\)}/g, "${$1}")

        // Run all prompt permutations through the LLM to generate + cache responses:
        const response = fetch('http://localhost:5000/queryllm', {
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
            body: JSON.stringify({
                id: id,
                llm: selectedLLMs,
                prompt: py_prompt_template,
                vars: pulled_data,
                params: {
                    temperature: 0.5,
                    n: 3,
                },
                no_cache: true,
            }),
        }).then(function(response) {
            return response.json();
        }).then(function(json) {

            if (json.responses) {
                // Success! Change status to 'ready':
                setStatusIcon(genStatusIcon('ready'));
                setPromptTextOnLastRun(promptText);

                console.log(json.responses);
            } else if (json.error) {
                console.error(json.error);
            }
        });

        // Change the 'run' button icon back to normal:
        // ... 

        console.log(pulled_data);
    } else {
        console.log('Not connected! :(');

        // Blink the names of unconnected params:
        const names_to_blink = templateVars.filter(name => {
            return !edges.some(e => (e.target == id && e.targetHandle == name));
        });
        setTemplateHooks(
            genTemplateHooks(templateVars, names_to_blink)
        );

        // Set timeout to turn off blinking:
        setTimeout(() => {
            setTemplateHooks(
                genTemplateHooks(templateVars, [])
            );
        }, 750*2);
    }
  }

  const stopDragPropagation = (event) => {
    // Stop this event from bubbling up to the node
    event.stopPropagation();
  }

  const handleLLMChecked = (event) => {
    console.log(event.target.value, event.target.checked);
    if (event.target.checked) {
        if (!selectedLLMs.includes(event.target.value)) {
            // Add the selected LLM to the list:
            setSelectedLLMs(selectedLLMs.concat([event.target.value]))
        }
    } else {
        if (selectedLLMs.includes(event.target.value)) {
            // Remove the LLM from the selected list:
            const removeByIndex = (array, index) => array.filter((_, i) => i !== index);
            setSelectedLLMs(removeByIndex(selectedLLMs, selectedLLMs.indexOf(event.target.value)));
        }
    }
  }
  
  const borderStyle = hovered
    ? '1px solid #222'
    : '1px solid #999';

  return (
    <div 
      className="prompt-node"
      style={{ border: borderStyle }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="node-header drag-handle">
        Prompt Node
        {statusIcon}
        <button className="AmitSahoo45-button-3" onClick={handleRunClick}><div className="play-button"></div></button>
      </div>
      <div className="input-field">
        <textarea
          rows="4"
          cols="40"
          defaultValue={data.prompt}
          onChange={handleInputChange}
          onMouseDownCapture={stopDragPropagation}
        />
        <Handle
          type="source"
          position="right"
          id="prompt"
          style={{ top: '50%', background: '#555' }}
        />
      </div>
      <div className="template-hooks"> 
        {templateHooks}
      </div>
      <div>
        <hr />
        <p style={{marginTop: 0}} >LLMs:</p>
        <div onMouseDownCapture={stopDragPropagation}>
            <input type="checkbox" id="gpt3.5" name="gpt3.5" value="gpt3.5" defaultChecked={true} onChange={handleLLMChecked} />
            <label htmlFor="gpt3.5">GPT3.5  </label>
            <input type="checkbox" id="alpaca.7B" name="alpaca.7B" value="alpaca.7B" onChange={handleLLMChecked} />
            <label htmlFor="alpaca.7B">Alpaca 7B</label>
        </div>
      </div>
    </div>
  );
};

export default PromptNode;