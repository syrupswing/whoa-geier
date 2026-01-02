import{a as i}from"./chunk-DQ7Z32SK.js";import{Z as u,e as s}from"./chunk-M5WQ34XW.js";var p=(()=>{class a{constructor(){this.API_URL="https://models.inference.ai.azure.com/chat/completions"}isConfigured(){return!!i.githubToken&&i.githubToken!=="YOUR_GITHUB_PAT"&&i.githubToken.startsWith("github_pat_")}suggestRecipes(o,e){return s(this,null,function*(){let t=`${e?e+`

`:""}Generate 3 recipe suggestions based on: ${o}

Please respond with a JSON array of recipes in this exact format:
[
  {
    "name": "Recipe Name",
    "description": "Brief description",
    "prepTime": 15,
    "cookTime": 30,
    "servings": 4,
    "ingredients": ["ingredient 1", "ingredient 2"],
    "instructions": ["step 1", "step 2"],
    "tags": ["tag1", "tag2"]
  }
]

Only return valid JSON, no additional text.`,r=yield this.generateContent(t);if(!r.success)throw new Error(r.error||"Failed to generate recipe suggestions");try{let n=r.text.match(/\[[\s\S]*\]/);if(!n)throw new Error("No valid JSON found in response");return JSON.parse(n[0])}catch(n){throw console.error("Error parsing recipe suggestions:",n),new Error("Failed to parse recipe suggestions")}})}suggestGroceries(o,e){return s(this,null,function*(){let t=e?.length?`

Existing items (don't duplicate): ${e.join(", ")}`:"",r=`Based on these planned recipes: ${o.join(", ")}${t}

Generate a comprehensive grocery list. Return only a JSON array of strings, no additional text:
["item 1", "item 2", "item 3"]`,n=yield this.generateContent(r);if(!n.success)throw new Error(n.error||"Failed to generate grocery suggestions");try{let c=n.text.match(/\[[\s\S]*\]/);if(!c)throw new Error("No valid JSON found in response");return JSON.parse(c[0])}catch(c){throw console.error("Error parsing grocery suggestions:",c),new Error("Failed to parse grocery suggestions")}})}suggestMealPlan(o,e=7){return s(this,null,function*(){let t=`Create a ${e}-day meal plan based on: ${o}

Return only a JSON array in this format, no additional text:
[
  {
    "day": "Monday",
    "breakfast": "meal name",
    "lunch": "meal name",
    "dinner": "meal name",
    "snacks": ["snack 1", "snack 2"]
  }
]`,r=yield this.generateContent(t);if(!r.success)throw new Error(r.error||"Failed to generate meal plan");try{let n=r.text.match(/\[[\s\S]*\]/);if(!n)throw new Error("No valid JSON found in response");return JSON.parse(n[0])}catch(n){throw console.error("Error parsing meal plan:",n),new Error("Failed to parse meal plan")}})}suggestRestaurants(o,e){return s(this,null,function*(){let t=`Suggest 3-5 ${o} restaurants or food delivery options. ${e?`Preferences: ${e}`:""}
    
Provide brief descriptions and what makes each one special. Format as a simple text list.`,r=yield this.generateContent(t);if(!r.success)throw new Error(r.error||"Failed to generate restaurant suggestions");return r.text})}generateContent(o){return s(this,null,function*(){if(!this.isConfigured())return{success:!1,text:"",error:"GitHub Personal Access Token not configured. Please add your token to the environment file."};try{let e=yield fetch(this.API_URL,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${i.githubToken}`},body:JSON.stringify({model:"gpt-4o-mini",messages:[{role:"user",content:o}],temperature:.7,max_tokens:2048})});if(!e.ok){let n=yield e.json().catch(()=>({}));throw new Error(n.error?.message||`API request failed: ${e.status}`)}let t=yield e.json();if(!t.choices||!t.choices[0]?.message?.content)throw new Error("Invalid response format from OpenAI API");let r=t.choices[0].message.content;return this.incrementApiCounter(),{success:!0,text:r}}catch(e){return console.error("GitHub Models API error:",e),{success:!1,text:"",error:e.message||"Unknown error occurred"}}})}incrementApiCounter(){let e=parseInt(localStorage.getItem("githubApiCallCount")||"0",10)+1;localStorage.setItem("githubApiCallCount",e.toString()),window.dispatchEvent(new StorageEvent("storage",{key:"githubApiCallCount",newValue:e.toString()}))}getCookingHelp(o){return s(this,null,function*(){let e=`You are a helpful cooking assistant. Answer this question briefly and practically: ${o}`,t=yield this.generateContent(e);if(!t.success)throw new Error(t.error||"Failed to get cooking help");return t.text})}static{this.\u0275fac=function(e){return new(e||a)}}static{this.\u0275prov=u({token:a,factory:a.\u0275fac,providedIn:"root"})}}return a})();export{p as a};
